/*
 * Photos are prepared on the device before anything is sent: scaled to at most 1,600 px on the long edge and
 * re-encoded as JPEG, which also drops EXIF data such as location. The fingerprint (SHA-256 of the prepared bytes) lets
 * a photo that was already read be answered from the device for free. The photo itself is never stored.
 */

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.8;

export interface PreparedImage { base64: string; mediaType: "image/jpeg"; width: number; height: number; fingerprint: string; previewUrl: string }

/** Target size: the long edge at most `maxEdge`, never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image. Choose a photo (JPEG, PNG, HEIC or WebP).");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("This browser couldn't open that image. Try a JPEG or PNG."); }
  const size = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't prepare images.");
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("Couldn't prepare the photo.")), "image/jpeg", JPEG_QUALITY));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    base64: toBase64(bytes), mediaType: "image/jpeg", ...size,
    fingerprint: [...digest].map(byte => byte.toString(16).padStart(2, "0")).join(""),
    previewUrl: URL.createObjectURL(blob),
  };
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/**
 * About how many input tokens an image costs, by each provider's published rule of thumb: Anthropic ≈ width × height /
 * 750 (after scaling to at most 1,568 px and 1.15 megapixels); OpenAI high detail = 85 + 170 per 512-px tile after
 * fitting within 2,048 px with the short side at most 768 px. Estimates only; the usage reports the real count.
 */
export function imageTokens(provider: "anthropic" | "openai", width: number, height: number) {
  if (provider === "anthropic") {
    let { width: w, height: h } = fitWithin(width, height, 1568);
    const pixels = w * h, limit = 1_150_000;
    if (pixels > limit) { const scale = Math.sqrt(limit / pixels); w = Math.floor(w * scale); h = Math.floor(h * scale); }
    return Math.ceil((w * h) / 750);
  }
  let { width: w, height: h } = fitWithin(width, height, 2048);
  const shortSide = Math.min(w, h);
  if (shortSide > 768) { const scale = 768 / shortSide; w = Math.round(w * scale); h = Math.round(h * scale); }
  return 85 + 170 * Math.ceil(w / 512) * Math.ceil(h / 512);
}
