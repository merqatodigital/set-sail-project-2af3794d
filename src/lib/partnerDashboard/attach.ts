// =============================================================================
// Partner Dashboard — URL detection, auto-linking, and smart chips
// =============================================================================
// Paste a URL into a comment and it is classified here, then rendered either
// as a provider chip or (for direct image links) an inline thumbnail.
//
// Everything passes through safeUrl() before it is ever rendered, so a
// javascript: or data: URL cannot become a clickable link. safeUrl() is the
// dashboard-local twin of safeHref() in src/lib/security.ts, kept free of the
// DOMPurify import so server code can share it.
// =============================================================================

import { safeUrl } from "./sanitize";
import { IMAGE_LIMITS } from "./config";
import type { LinkChip } from "./types";
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|avif|bmp)$/i;

/**
 * Matches http(s) URLs inside free text. The trailing character class is
 * deliberately excluded so a URL followed by a period or a closing bracket
 * ("see https://x.com/a).") does not swallow the punctuation.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

function trimTrailingPunctuation(url: string): string {
  return url.replace(TRAILING_PUNCTUATION, "");
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Classifies one URL into the chip taxonomy from the brief:
 *   Google Drive / Docs / Sheets / Slides → 📄
 *   Figma                                 → 🎨
 *   YouTube / Vimeo                       → ▶️
 *   Direct image URL                      → inline thumbnail
 *   Notion                                → 📝 (covered by the intro's
 *                                              "Google Drive, Figma, Notion, etc.")
 *   Everything else                       → 🔗
 */
export function detectLink(rawUrl: string): LinkChip {
  const safe = safeUrl(rawUrl, "");
  if (!safe) return { kind: "generic", icon: "🔗", label: "Link" };

  let parsed: URL;
  try {
    parsed = new URL(safe);
  } catch {
    return { kind: "generic", icon: "🔗", label: "Link" };
  }

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const path = parsed.pathname;

  // --- Google Drive / Docs family -----------------------------------------
  if (hostMatches(host, "drive.google.com")) {
    const label = path.includes("/folders/") ? "Drive folder" : "Drive file";
    return { kind: "drive", icon: "📄", label };
  }
  if (hostMatches(host, "docs.google.com")) {
    if (path.startsWith("/document")) return { kind: "drive", icon: "📄", label: "Google Doc" };
    if (path.startsWith("/spreadsheets"))
      return { kind: "drive", icon: "📄", label: "Google Sheet" };
    if (path.startsWith("/presentation"))
      return { kind: "drive", icon: "📄", label: "Google Slides" };
    if (path.startsWith("/forms")) return { kind: "drive", icon: "📄", label: "Google Form" };
    return { kind: "drive", icon: "📄", label: "Drive link" };
  }

  // --- Design ---------------------------------------------------------------
  if (hostMatches(host, "figma.com")) return { kind: "figma", icon: "🎨", label: "Figma" };

  // --- Video ---------------------------------------------------------------
  if (hostMatches(host, "youtube.com") || host === "youtu.be")
    return { kind: "video", icon: "▶️", label: "YouTube" };
  if (hostMatches(host, "vimeo.com")) return { kind: "video", icon: "▶️", label: "Vimeo" };

  // --- Notes ---------------------------------------------------------------
  if (hostMatches(host, "notion.so") || hostMatches(host, "notion.site"))
    return { kind: "notion", icon: "📝", label: "Notion" };

  // --- Direct image → inline thumbnail -------------------------------------
  // The extension is checked on the pathname only, so a query string such as
  // ?v=2 does not defeat detection.
  if (IMAGE_EXTENSION.test(path)) {
    return { kind: "image", icon: "🖼️", label: "Image", thumbnailUrl: safe };
  }

  return { kind: "generic", icon: "🔗", label: "Link" };
}

/** Extracts every URL from free text, de-duplicated, capped at the limit. */
export function extractUrls(text: string, limit = IMAGE_LIMITS.maxLinksPerComment): string[] {
  const found = text.match(URL_PATTERN) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const url = trimTrailingPunctuation(raw);
    if (!url || seen.has(url)) continue;
    if (!safeUrl(url, "")) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= limit) break;
  }
  return out;
}

export type TextSegment = { type: "text"; value: string } | { type: "url"; value: string };

/**
 * Splits a comment body into plain-text and URL segments so the renderer can
 * turn URLs into anchors without ever using dangerouslySetInnerHTML.
 * React escapes the text segments for us — this is the XSS-safe path.
 */
export function linkifySegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  // A fresh regex per call: the module-level one is stateful under /g.
  const pattern = new RegExp(URL_PATTERN.source, "gi");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const url = trimTrailingPunctuation(raw);
    const start = match.index;

    if (start > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    if (safeUrl(url, "")) {
      segments.push({ type: "url", value: url });
    } else {
      segments.push({ type: "text", value: url });
    }

    // Put any stripped punctuation back into the text stream.
    const trailing = raw.slice(url.length);
    if (trailing) segments.push({ type: "text", value: trailing });

    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}

// Note: the server-side text sanitizer lives in ./sanitize.ts, not here, so
// that this module's DOMPurify dependency (via @/lib/security) stays on the
// client side of the bundle.
