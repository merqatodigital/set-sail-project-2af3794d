// =============================================================================
// Partner Dashboard — single source of truth for every tunable
// =============================================================================
// The brief asked for limits to be "configurable in one place". This is that
// place: change a number here and both the client UI and the server-side
// validators (which import this same file) pick it up.
// =============================================================================

export const IMAGE_LIMITS = {
  /** Max size of a single image before compression, in bytes (10 MB). */
  maxBytesPerImage: 10 * 1024 * 1024,
  /** Max images attached to one comment. */
  maxImagesPerComment: 6,
  /** Max pasted URLs attached to one comment ("no limit beyond sanity (10)"). */
  maxLinksPerComment: 10,
  /** Max characters in a comment body (server truncates, client warns). */
  maxCommentChars: 4000,
  /** Max authors per comment body string field (guards the DB column). */
  maxAuthorChars: 60,
  /**
   * Images larger than this are always re-encoded; smaller ones are passed
   * through untouched so a 40 KB screenshot is not needlessly degraded.
   */
  skipCompressionUnderBytes: 200 * 1024,
  /** Longest edge after compression, in pixels. */
  maxDimension: 1800,
  /** JPEG/WebP quality used by the canvas re-encode. */
  quality: 0.82,
  /**
   * When no blob/storage backend is reachable, images under this size are
   * inlined as base64 data URLs directly in the DB. Anything larger is
   * rejected rather than silently bloating a Postgres row.
   */
  base64FallbackMaxBytes: 500 * 1024,
  /** MIME types accepted by the file picker, drag-drop, and the server. */
  acceptedTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ] as const,
} as const;

/** Write rate limits, enforced per IP per hour by the server. */
export const RATE_LIMITS = {
  commentsPerHour: 20,
  uploadsPerHour: 10,
  /** Passcode attempts allowed per IP per hour before lockout. */
  passcodeAttemptsPerHour: 30,
} as const;

/** Supabase Storage bucket for uploaded comment images. */
export const STORAGE_BUCKET = "comment-images";

/** API endpoints, kept in one place so the paths are never scattered. */
export const API = {
  projects: "/api/projects",
  comments: "/api/comments",
  upload: "/api/upload",
} as const;

/** localStorage keys. Namespaced so they never collide with the CMS cache. */
export const LS_KEYS = {
  profile: "mt-partner-profile-v1",
  passcode: "mt-partner-passcode-v1",
  comments: "mt-partner-comments-v1",
  outbox: "mt-partner-outbox-v1",
  lastSeen: "mt-partner-lastseen-v1",
  openThreads: "mt-partner-open-threads-v1",
} as const;

/**
 * Built-in fallback passcode. The owner specified a single shared code used
 * across their tools ("all passkeys are 5309"), and asked for it to work
 * immediately — so this default keeps the dashboard writable out of the box.
 *
 * Override it by setting DASHBOARD_PASSCODE in the environment. The server
 * logs a warning on boot whenever this default is still in use.
 *
 * Note: this is a 4-digit code, so the server enforces
 * RATE_LIMITS.passcodeAttemptsPerHour against brute force. If the dashboard
 * ever holds anything sensitive, set a longer DASHBOARD_PASSCODE.
 */
export const DEFAULT_PASSCODE = "5309";

/** Default author names offered in the profile switcher. */
export const AUTHORS = ["James", "Merqato"] as const;
export const DEFAULT_AUTHOR = "James";

/**
 * Date/time option sets for "Last updated" lines. Split into two so the
 * separators can be assembled explicitly ("Feb 14, 2026 · 3:42 PM").
 */
export const DATE_FORMAT = {
  date: { month: "short", day: "numeric", year: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;
