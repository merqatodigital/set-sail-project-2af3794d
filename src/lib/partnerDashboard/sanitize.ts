// =============================================================================
// Partner Dashboard — dependency-free text sanitisation
// =============================================================================
// Deliberately isolated from src/lib/security.ts: that module imports
// DOMPurify, which is a browser library. The server entry imports this file,
// so keeping it free of DOM dependencies keeps the Nitro/Workers bundle clean.
//
// The client never renders a comment body as HTML (React escapes text and the
// renderer walks React nodes), so this is defence in depth: it protects
// anything reading the stored value directly — a psql session, an export, a
// future integration.
// =============================================================================

/**
 * Removes scripts, tags and control characters, then trims to `maxChars`.
 * Angle brackets are stripped as well so a partially-formed tag cannot survive
 * a later, less careful renderer.
 */
export function sanitizeCommentText(input: string, maxChars: number): string {
  return (
    input
      // Remove script/style blocks including their contents first, so their
      // inner text does not leak into the comment.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      // Strip every remaining tag.
      .replace(/<[^>]*>/g, "")
      // Neutralise stray angle brackets left behind by malformed markup.
      .replace(/[<>]/g, "")
      // Strip control characters except newline and tab.
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim()
      .slice(0, maxChars)
  );
}

/**
 * Pure URL-scheme allowlist — the same rule as safeHref() in
 * src/lib/security.ts, without the DOMPurify import.
 */
export function safeUrl(input: string, fallback = ""): string {
  const value = (input || "").trim();
  if (!value) return fallback;
  if (
    value.startsWith("#") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../")
  ) {
    return value;
  }
  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();
    if (["http:", "https:", "mailto:", "tel:"].includes(protocol)) return value;
    return fallback;
  } catch {
    return fallback;
  }
}
