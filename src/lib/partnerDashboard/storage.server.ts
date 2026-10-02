// =============================================================================
// Partner Dashboard — storage resolution for comment images
// =============================================================================
// Three tiers, in the order the brief specifies:
//
//   1. Supabase Storage, bucket "comment-images"  (when the Supabase backend
//      is active). With SUPABASE_SERVICE_KEY the server uploads directly; with
//      only the public key the bucket's RLS insert policy covers it.
//   2. Vercel Blob via BLOB_READ_WRITE_TOKEN     (the Neon path, since Neon is
//      database-only). Loaded through the official SDK by dynamic import, so
//      it never touches the client bundle and a missing package degrades to
//      tier 3 instead of breaking the build.
//   3. base64-in-DB for files under IMAGE_LIMITS.base64FallbackMaxBytes (500 KB).
//
// SERVER ONLY.
// =============================================================================

import { IMAGE_LIMITS } from "./config";
import { runtimeValue, type PartnerDb } from "./db.server";

export type StorageMode = "supabase" | "blob" | "base64";

export interface StorageResult {
  url: string;
  mode: StorageMode;
  base64: boolean;
}

/**
 * Uploads bytes and returns a public URL.
 * Throws when nothing can store the file, or when the file is too large for
 * the base64 last resort.
 */
export async function storeImage(
  env: unknown,
  db: PartnerDb | null,
  bytes: Uint8Array,
  contentType: string,
  path: string,
): Promise<StorageResult> {
  // --- 1. Supabase Storage -------------------------------------------------
  if (db?.kind === "supabase" && db.uploadImage) {
    try {
      const url = await db.uploadImage(bytes, contentType, path);
      return { url, mode: "supabase", base64: false };
    } catch (error) {
      console.error("[partner-dashboard] Supabase Storage upload failed:", error);
      // fall through to Blob, then base64
    }
  }

  // --- 2. Vercel Blob ------------------------------------------------------
  const blobToken = runtimeValue(env, "BLOB_READ_WRITE_TOKEN");
  if (blobToken) {
    try {
      // Dynamic so the SDK never enters the client bundle.
      const { put } = await import("@vercel/blob");

      // Copied into a plain ArrayBuffer: a Uint8Array can be backed by a
      // SharedArrayBuffer, which BlobPart does not accept.
      const arrayBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(arrayBuffer).set(bytes);

      const result = await put(path, new Blob([arrayBuffer], { type: contentType }), {
        access: "public",
        token: blobToken,
        contentType,
        addRandomSuffix: true,
      });
      return { url: result.url, mode: "blob", base64: false };
    } catch (error) {
      console.error(
        "[partner-dashboard] Vercel Blob upload failed" +
          (error instanceof Error && /Cannot find module/.test(error.message)
            ? " — is @vercel/blob installed?"
            : ":") ,
        error,
      );
    }
  }

  // --- 3. base64 in the DB (small files only) ------------------------------
  if (bytes.byteLength <= IMAGE_LIMITS.base64FallbackMaxBytes) {
    console.warn(
      `[partner-dashboard] No storage backend available; inlining ${bytes.byteLength} B as base64. ` +
        `Only files under ${IMAGE_LIMITS.base64FallbackMaxBytes} B can take this path.`,
    );
    return { url: toDataUrl(bytes, contentType), mode: "base64", base64: true };
  }

  throw new Error(
    `No image storage is configured and this file is larger than ${Math.round(
      IMAGE_LIMITS.base64FallbackMaxBytes / 1024,
    )} KB. Set SUPABASE_SERVICE_KEY (for the comment-images bucket) or BLOB_READ_WRITE_TOKEN.`,
  );
}

/** Encodes bytes as a data URL without Node's Buffer (Workers-safe). */
function toDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  const chunkSize = 0x8000; // avoid blowing the argument limit on large arrays
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

/**
 * Real content-type detection from the file's magic bytes. The declared
 * Content-Type header and the filename are both client-controlled and
 * therefore never trusted on their own.
 */
export function sniffImageType(bytes: Uint8Array): string | null {
  const startsWith = (signature: number[], offset = 0): boolean =>
    signature.every((byte, index) => bytes[offset + index] === byte);

  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  // RIFF....WEBP
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  // ISO-BMFF brand check: ....ftyp{avif|avis|heic|mif1}
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "heic" || brand === "heix" || brand === "mif1") return "image/heic";
  }
  return null;
}

/** Canonical extension for a sniffed MIME type. */
export function extensionFor(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
}
