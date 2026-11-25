import { useEffect, useRef, useState } from "react";
import { liveQuery } from "dexie";
import type { AiProvider, AiTier } from "@perfect-draw/shared";
import { Badge, Button, ChoiceChips } from "../components/ui";
import { toast } from "../components/Toasts";
import { errorMessage } from "../hooks/useActionRunner";
import { formatCost, MODELS, modelFor, PRICES_CHECKED, PROVIDERS, TIERS } from "./models";
import { getProvider } from "./router";
import { aiService, usageService, useAiStore } from "./store";

const maskKey = (key: string) => key.length <= 10 ? "••••" : `${key.slice(0, 6)}…${key.slice(-4)}`;
const monthStart = () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1).getTime(); };

/** One provider: add, test (free) or forget its key. */
function ProviderKey({ provider }: { provider: AiProvider }) {
  const info = PROVIDERS.find(item => item.id === provider)!;
  const key = useAiStore(state => state.keys[provider]);
  const [draft, setDraft] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const add = async () => {
    try { await aiService.setKey(provider, draft); setDraft(""); setResult(null); toast.success(`${info.name} key added.`); }
    catch (error) { setResult({ ok: false, text: errorMessage(error) }); }
  };
  const test = async () => {
    setTesting(true); setResult(null);
    try {
      const outcome = await (await getProvider(provider)).test();
      setResult(outcome.ok ? { ok: true, text: "Connected. The key works." } : { ok: false, text: outcome.error });
    } catch (error) { setResult({ ok: false, text: errorMessage(error) }); }
    finally { setTesting(false); }
  };
  return <div className="ai-provider" aria-label={info.name} role="group">
    <div className="ai-provider-head"><strong>{info.name}</strong>{key ? <Badge tone="success" dot>Key added</Badge> : <Badge>No key</Badge>}</div>
    {key ? <div className="ai-provider-row">
      <code className="ai-key">{maskKey(key)}</code>
      <Button variant="secondary" size="sm" loading={testing} loadingLabel="Testing…" onClick={() => void test()}>Test connection</Button>
      <Button variant="secondary" size="sm" onClick={() => { void aiService.forgetKey(provider); setResult(null); }}>Forget key</Button>
    </div> : <form className="ai-provider-row" onSubmit={event => { event.preventDefault(); void add(); }}>
      <input className="ai-key-input" type="password" autoComplete="off" spellCheck={false} value={draft} onChange={event => setDraft(event.target.value)}
        placeholder={info.keyHint} aria-label={`${info.name} API key`} />
      <Button type="submit" size="sm" disabled={!draft.trim()}>Add key</Button>
      <a className="ai-get-key" href={info.keysUrl} target="_blank" rel="noreferrer">Get a key</a>
    </form>}
    {result && <p className={`ai-result ${result.ok ? "is-ok" : "is-error"}`} role={result.ok ? "status" : "alert"}>{result.text}</p>}
    <p className="ai-note">Test connection reads the provider's model list, which is free.</p>
  </div>;
}

/** This month's AI calls and their estimated cost, by model, kept up to date as calls are made. */
function UsageSummary() {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof usageService.summary>> | null>(null);
  useEffect(() => {
    const subscription = liveQuery(() => usageService.summary(monthStart())).subscribe({ next: setSummary, error: () => setSummary(null) });
    return () => subscription.unsubscribe();
  }, []);
  return <div className="ai-usage" aria-label="AI usage this month" role="group">
    <div className="ai-usage-head"><strong>This month</strong><span>{summary ? `${summary.calls} call${summary.calls === 1 ? "" : "s"} · about ${formatCost(summary.cost)}` : "…"}</span></div>
    {summary && summary.models.length > 0 && <table className="ai-usage-table">
      <thead><tr><th scope="col">Model</th><th scope="col">Calls</th><th scope="col">Tokens in / out</th><th scope="col">Est. cost</th></tr></thead>
      <tbody>{summary.models.map(row => <tr key={row.model}>
        <th scope="row">{MODELS.find(model => model.id === row.model)?.name ?? row.model}</th><td>{row.calls}</td>
        <td>{row.inputTokens.toLocaleString("en-US")} / {row.outputTokens.toLocaleString("en-US")}</td><td>{formatCost(row.cost)}</td>
      </tr>)}</tbody>
    </table>}
    <p className="ai-note">Estimates use list prices checked {PRICES_CHECKED}; your provider's billing is the final word.
      {summary && summary.calls > 0 && <> <button type="button" className="link-button" onClick={() => void usageService.clear()}>Clear usage log</button></>}</p>
  </div>;
}

/** Settings → AI: keys, where they are kept, the default model for explanations, fallback, and usage. */
export function AiSettingsPanel() {
  const settings = useAiStore(state => state.settings);
  const keys = useAiStore(state => state.keys);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { void aiService.load(); }, []);
  useEffect(() => { if (window.location.hash.includes("section=ai")) ref.current?.scrollIntoView({ block: "start" }); }, []);
  if (!settings) return null;
  const both = !!keys.anthropic && !!keys.openai;
  return <section ref={ref} id="ai-settings" className="panel panel-pad ai-settings" aria-labelledby="ai-heading">
    <div className="panel-title"><div><p className="eyebrow">AI COACH</p><h2 id="ai-heading">AI explanations</h2>
      <p>Bring your own API key. Calls go straight from this browser to the provider; nothing passes through any other server. Without a key, everything else works.</p></div></div>
    <div className="ai-providers">{PROVIDERS.map(item => <ProviderKey key={item.id} provider={item.id} />)}</div>

    <label className="ai-check">
      <input type="checkbox" checked={settings.rememberKeys} onChange={event => void aiService.setRemember(event.target.checked)} />
      <span><strong>Remember keys on this device</strong> Off: keys are forgotten when you close the app.</span>
    </label>
    {settings.rememberKeys && <div className="warning-card">Stored unencrypted in this browser. Anyone with access to this device or browser profile can read it.</div>}

    <div className="ai-defaults">
      <p className="field-label">Explanations use</p>
      <ChoiceChips label="Default provider for explanations" value={settings.coachProvider}
        onChange={(value: AiProvider) => void aiService.updateSettings({ coachProvider: value })}
        choices={PROVIDERS.map(item => ({ value: item.id, label: item.name, hint: keys[item.id] ? "Key added" : "No key yet" }))} />
      <p className="field-label">Model size</p>
      <ChoiceChips label="Default model size" value={settings.coachTier} onChange={(value: AiTier) => void aiService.updateSettings({ coachTier: value })}
        choices={TIERS.map(tier => {
          const model = modelFor(settings.coachProvider, tier.id);
          return { value: tier.id, label: tier.label, hint: `${model.name} · $${model.inputPerM} / $${model.outputPerM} per 1M tokens` };
        })} />
      <p className="ai-note">You can also pick the model each time you press Explain.</p>
    </div>

    <label className="ai-check">
      <input type="checkbox" checked={settings.fallbackEnabled} disabled={!both} onChange={event => void aiService.updateSettings({ fallbackEnabled: event.target.checked })} />
      <span><strong>Try the other provider if one is busy or declines</strong> {both ? "Uses the same model size." : "Needs both keys."}</span>
    </label>

    <UsageSummary />
  </section>;
}
