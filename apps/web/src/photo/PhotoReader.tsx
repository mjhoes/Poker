import { useEffect, useRef, useState } from "react";
import type { AiProvider, AiTier } from "@perfect-draw/shared";
import { Button, ChoiceChips } from "../components/ui";
import { Icon } from "../components/Icons";
import { errorMessage } from "../hooks/useActionRunner";
import { formatCost, modelFor, PROVIDERS, TIERS } from "../ai/models";
import { aiService, useAiStore } from "../ai/store";
import { prepareImage } from "./image";
import type { PreparedImage } from "./image";
import { photoService } from "./photo-service";
import { signal } from "../diagnostics";
import type { PhotoKind } from "./photo-service";

export type PhotoResult<K extends PhotoKind> = Awaited<ReturnType<typeof photoService.read<K>>> & { image: PreparedImage };

/**
 * Take or choose a photo (or paste one), see it and what reading it will cost, then press Read photo. Nothing is sent
 * before that. The photo is prepared on the device and kept only in memory while this is open.
 */
export function PhotoReader<K extends PhotoKind>({ kind, initialImage, onRead, error: outerError }: {
  kind: K; initialImage?: PreparedImage; error?: string;
  /** Receives the reading and its image (now the caller's). Return false to decline it: the reader keeps the image. */
  onRead: (result: PhotoResult<K>) => boolean | void;
}) {
  const settings = useAiStore(state => state.settings);
  const keys = useAiStore(state => state.keys);
  useEffect(() => { if (!settings) void aiService.load(); }, [settings]);
  const [image, setImage] = useState<PreparedImage | null>(initialImage ?? null);
  const [preparing, setPreparing] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [tier, setTier] = useState<AiTier | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /*
   * Ownership of preview images: an image this reader prepared is its own until it is handed over in `onRead`, and is
   * released (its blob URL revoked) when replaced or when the reader closes. `initialImage` belongs to the caller.
   * A read that finishes after the reader closed or the photo changed is dropped, never handed over.
   */
  const owned = useRef(new Set<string>());
  const current = useRef<PreparedImage | null>(image);
  current.current = image;
  const live = useRef(true);
  const request = useRef(0);
  const release = (url: string) => { if (owned.current.delete(url)) URL.revokeObjectURL(url); };
  useEffect(() => {
    live.current = true;
    const urls = owned.current;
    return () => { live.current = false; request.current++; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  }, []);

  // Each chosen or pasted photo gets a number: only the newest one's preparation is used, whatever order they finish in.
  const preparation = useRef(0);
  const accept = async (file: Blob | null | undefined) => {
    if (!file) return;
    const ticket = ++preparation.current;
    request.current++; // a read of the photo on screen no longer applies, from this moment
    setReading(false); setPreparing(true); setError("");
    try {
      const prepared = await prepareImage(file);
      if (!live.current || preparation.current !== ticket) { URL.revokeObjectURL(prepared.previewUrl); signal("photo:prepare-dropped"); return; } // superseded
      owned.current.add(prepared.previewUrl);
      if (current.current) release(current.current.previewUrl);
      setImage(prepared);
    }
    catch (reason) { if (live.current && preparation.current === ticket) setError(errorMessage(reason)); }
    finally { if (live.current && preparation.current === ticket) setPreparing(false); }
  };
  // Pasting a screenshot or copied photo works anywhere while this is open.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...event.clipboardData?.files ?? []].find(item => item.type.startsWith("image/"));
      if (file) { event.preventDefault(); void accept(file); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  if (!settings) return null;
  const available = PROVIDERS.filter(item => keys[item.id]).map(item => item.id);
  const chosenProvider = provider && keys[provider] ? provider : keys[settings.visionProvider] ? settings.visionProvider : available[0] ?? null;
  const chosenTier = tier ?? settings.visionTier;
  const what = kind === "paytable" ? "pay table" : "hand";

  const read = async () => {
    if (!image || !chosenProvider) return;
    const asked = ++request.current, photo = image;
    setReading(true); setError("");
    try {
      const result = await photoService.read(kind, photo, chosenProvider, chosenTier);
      if (!live.current || request.current !== asked || current.current !== photo) { signal("photo:read-dropped"); return; } // closed or replaced meanwhile
      if (onRead({ ...result, image: photo } as PhotoResult<K>) !== false) owned.current.delete(photo.previewUrl); // handed over
    }
    catch (reason) { if (live.current && request.current === asked) setError(errorMessage(reason)); }
    finally { if (live.current && request.current === asked) setReading(false); }
  };

  return <div className="photo-reader" role="group" aria-label={`Read a ${what} from a photo`}>
    <input ref={input} className="visually-hidden" type="file" accept="image/*,.heic,.heif" capture="environment" aria-label={`Photo of the ${what}`}
      onChange={event => { void accept(event.target.files?.[0]); event.target.value = ""; }} />
    <div className={`photo-drop ${image ? "has-image" : ""}`}>
      {image ? <img src={image.previewUrl} alt={`Your photo of the ${what}`} /> : <div className="photo-empty"><Icon name="camera" size={28} /><p>Take a photo of the {kind === "paytable" ? "machine's pay table, straight on and filling the frame" : "five cards on the machine's screen"}, or choose one. You can also paste an image.</p></div>}
    </div>
    <div className="photo-actions">
      <Button variant="secondary" icon="camera" loading={preparing} loadingLabel="Preparing…" onClick={() => input.current?.click()}>{image ? "Use another photo" : "Take or choose a photo"}</Button>
      {image && <span className="photo-meta">{image.width} × {image.height} · location and other details removed</span>}
    </div>

    {!chosenProvider ? <p className="photo-invite">Reading photos uses your own Anthropic or OpenAI API key. <a href="#/settings?section=ai">Add an API key</a></p>
      : image && <>
        {available.length > 1 && <ChoiceChips label="AI provider" value={chosenProvider} onChange={(value: AiProvider) => setProvider(value)}
          choices={available.map(id => ({ value: id, label: PROVIDERS.find(item => item.id === id)!.name.replace(/ \(.*\)$/, "") }))} />}
        <ChoiceChips label="Model size" value={chosenTier} onChange={(value: AiTier) => setTier(value)} className="explain-tiers"
          choices={TIERS.map(item => {
            const option = modelFor(chosenProvider, item.id);
            return { value: item.id, label: item.label, name: `${item.label}: ${option.name}`, hint: `${option.name} · about ${formatCost(photoService.estimate(kind, image, chosenProvider, item.id))}` };
          })} />
        <Button variant="gold" disabled={preparing} loading={reading} loadingLabel={`Reading with ${modelFor(chosenProvider, chosenTier).name}…`} onClick={() => void read()}>
          Read photo with {modelFor(chosenProvider, chosenTier).name} · about {formatCost(photoService.estimate(kind, image, chosenProvider, chosenTier))}</Button>
        <p className="ai-note">Sent to the provider with your key only when you press Read photo. The AI only reads the picture; the app checks every number, and nothing is saved until you confirm.</p>
      </>}
    {(error || outerError) && <p className="explain-error" role="alert">{error || outerError}</p>}
  </div>;
}
