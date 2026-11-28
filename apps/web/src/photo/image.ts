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

/** HEIF brands (the iPhone's HEIC among them), as written in an ISO-BMFF file's "ftyp" box. */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
/**
 * Whether a file is HEIC/HEIF, by its signature rather than its name or type: Windows and some browsers give a HEIC
 * photo an empty type, or none of "image/heic".
 */
export async function isHeif(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const text = (from: number) => String.fromCharCode(...head.subarray(from, from + 4));
  if (head.length < 16 || text(4) !== "ftyp") return false;
  const boxEnd = Math.min(head.length, ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0);
  const brands = [text(8)];
  for (let at = 16; at + 4 <= boxEnd; at += 4) brands.push(text(at));
  return brands.some(brand => HEIF_BRANDS.has(brand));
}

/**
 * The photo as a bitmap. Browsers decode JPEG, PNG and WebP themselves, and Safari also HEIC; elsewhere (Chrome, Edge,
 * Firefox) a HEIC photo is decoded here by libheif (heic-to, LGPL-3.0, loaded only when needed).
 */
async function decode(file: Blob): Promise<ImageBitmap> {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (native) {
    if (!await isHeif(file)) throw new Error("This browser couldn't open that image. Try a JPEG, PNG or HEIC photo.", { cause: native });
  }
  try {
    const { heicTo } = await import("heic-to/csp");
    return await heicTo({ blob: file, type: "bitmap" }) as ImageBitmap;
  }
  catch (reason) { throw new Error("Couldn't open this HEIC photo. Try another photo, or export it as JPEG.", { cause: reason }); }
}

export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!file.type.startsWith("image/") && !await isHeif(file)) throw new Error("That file isn't an image. Choose a photo (JPEG, PNG, HEIC or WebP).");
  const bitmap = await decode(file);
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
