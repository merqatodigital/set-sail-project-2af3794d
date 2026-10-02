// =============================================================================
// Partner Dashboard — client-side image preparation (zero dependencies)
// =============================================================================
// The brief allowed either browser-image-compression or a canvas resize. Canvas
// is used here on purpose: it keeps the new JS payload well under the 40 KB
// budget instead of adding a library to the critical path.
//
// Pipeline: validate → decode → downscale (only when needed) → re-encode to
// WebP (alpha-safe, ~25–35% smaller than JPEG) → hand back a Blob.
//
// GIFs are passed through untouched: re-encoding one would flatten its
// animation, which is worse than the bytes saved.
// =============================================================================

import { IMAGE_LIMITS } from "./config";

export type DraftStatus = "ready" | "uploading" | "uploaded" | "failed";

export interface ImageDraft {
  /** Stable client-side id; survives the upload round-trip. */
  uid: string;
  /** The bytes that will actually be uploaded (compressed when possible). */
  blob: Blob;
  /** Original filename, for the storage path and alt text. */
  name: string;
  /** object URL for the pre-submit thumbnail. Revoke when discarded. */
  previewUrl: string;
  originalBytes: number;
  bytes: number;
  width: number;
  height: number;
  status: DraftStatus;
  /** Remote URL, set once the upload succeeds. */
  url?: string;
  /** Populated when status === "failed", shown next to the retry button. */
  error?: string;
}

export interface RejectedFile {
  name: string;
  reason: string;
}

function newUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** True when this browser can encode WebP through canvas. */
let webpSupport: boolean | null = null;
function supportsWebp(): boolean {
  if (webpSupport !== null) return webpSupport;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    webpSupport = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpSupport = false;
  }
  return webpSupport;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas encoding returned no data"))),
      type,
      quality,
    );
  });
}

/**
 * Decodes, downscales and re-encodes one image.
 * Returns the original file unchanged when no useful reduction is available.
 */
export async function compressImage(file: File | Blob, name = "image"): Promise<Blob> {
  // Server-side rendering or a browser without canvas: pass through.
  if (typeof document === "undefined") return file;

  // Never re-encode a GIF — animation would be lost.
  if (file.type === "image/gif") return file;

  // Small files are already cheap; leaving them byte-identical avoids
  // generation loss on screenshots.
  if (file.size <= IMAGE_LIMITS.skipCompressionUnderBytes) return file;

  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    // imageOrientation honours EXIF rotation so portrait photos do not land
    // sideways after re-encoding.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Fall back to an <img> decode for formats createImageBitmap rejects.
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode failed"));
        el.src = url;
      });
      URL.revokeObjectURL(url);
      bitmap = img;
    } catch {
      return file; // Undecodable here — let the server validate the original.
    }
  }

  const sourceWidth = "width" in bitmap ? bitmap.width : 0;
  const sourceHeight = "height" in bitmap ? bitmap.height : 0;
  if (!sourceWidth || !sourceHeight) return file;

  const scale = Math.min(1, IMAGE_LIMITS.maxDimension / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  try {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0, targetWidth, targetHeight);
    if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

    const useWebp = supportsWebp();
    const type = useWebp ? "image/webp" : "image/jpeg";
    let blob = await canvasToBlob(canvas, type, IMAGE_LIMITS.quality);

    // A re-encode that grew the file is a net loss — keep the original.
    if (blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  }
}

/** Swaps a filename's extension to match the encoded blob type. */
function renameForType(name: string, type: string): string {
  const extension = type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${extension}`;
}

/** Measures a blob so we can store real width/height alongside the row. */
async function measure(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof document === "undefined") return { width: 0, height: 0 };
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    if (typeof bitmap.close === "function") bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * Validates and prepares a batch of dropped/selected files.
 * Enforces type, per-file size and per-comment count, returning both the
 * accepted drafts and human-readable reasons for anything rejected.
 */
export async function prepareImages(
  files: Array<File | Blob>,
  alreadyAttached: number,
): Promise<{ accepted: ImageDraft[]; rejected: RejectedFile[] }> {
  const accepted: ImageDraft[] = [];
  const rejected: RejectedFile[] = [];

  const room = IMAGE_LIMITS.maxImagesPerComment - alreadyAttached;
  if (room <= 0) {
    return {
      accepted,
      rejected: [
        {
          name: `${files.length} file(s)`,
          reason: `Limit is ${IMAGE_LIMITS.maxImagesPerComment} images per comment.`,
        },
      ],
    };
  }

  const batch = files.slice(0, room);
  for (const extra of files.slice(room)) {
    rejected.push({
      name: (extra as File).name ?? "file",
      reason: `Only ${IMAGE_LIMITS.maxImagesPerComment} images per comment.`,
    });
  }

  for (const file of batch) {
    const name = (file as File).name ?? "image";

    if (!(IMAGE_LIMITS.acceptedTypes as readonly string[]).includes(file.type)) {
      rejected.push({ name, reason: `${file.type || "Unknown type"} is not an accepted image format.` });
      continue;
    }
    if (file.size > IMAGE_LIMITS.maxBytesPerImage) {
      rejected.push({
        name,
        reason: `Larger than ${Math.round(IMAGE_LIMITS.maxBytesPerImage / 1024 / 1024)} MB.`,
      });
      continue;
    }

    const blob = await compressImage(file, name);
    const { width, height } = await measure(blob);
    const finalBlob = blob.type ? blob : new Blob([blob], { type: file.type || "image/jpeg" });

    accepted.push({
      uid: newUid(),
      blob: finalBlob,
      name: renameForType(name, finalBlob.type || "image/jpeg"),
      previewUrl: URL.createObjectURL(finalBlob),
      originalBytes: file.size,
      bytes: finalBlob.size,
      width,
      height,
      status: "ready",
    });
  }

  return { accepted, rejected };
}

/** Frees an object URL. Called when a draft is removed or the composer closes. */
export function revokeDraft(draft: Pick<ImageDraft, "previewUrl">): void {
  try {
    URL.revokeObjectURL(draft.previewUrl);
  } catch {
    /* ignore */
  }
}

/** "2.4 MB → 380 KB (84% smaller)" for the thumbnail tooltip. */
export function compressionLabel(draft: ImageDraft): string {
  const before = formatBytes(draft.originalBytes);
  const after = formatBytes(draft.bytes);
  if (draft.bytes >= draft.originalBytes) return `${after} · already optimised`;
  const saved = Math.round((1 - draft.bytes / draft.originalBytes) * 100);
  return `${before} → ${after} (${saved}% smaller)`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
