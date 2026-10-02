// =============================================================================
// Partner Dashboard — shared types (client + server)
// =============================================================================

export type ProjectStatus = "Live" | "In Progress" | "Planned" | "Blocked";

/** A row as authored in content/updates.json. */
export interface ProjectSeed {
  id: string;
  name: string;
  status: ProjectStatus | string;
  url?: string | null;
  image?: string | null;
  /** Local ISO timestamp, e.g. "2026-02-14T15:42:00". */
  updated?: string | null;
}

/** A seed row enriched with live comment data by GET /api/projects. */
export interface ProjectRow extends ProjectSeed {
  /** Number of non-deleted comments (replies included). */
  comment_count: number;
  /** ISO timestamp of the most recent non-deleted comment, or null. */
  last_comment_at: string | null;
  /**
   * Resolved "Last updated" value: whichever is later — the seed row's own
   * `updated` timestamp or the newest comment on the row.
   */
  last_updated: string;
}

export type AttachmentKind = "image" | "link";

export interface Attachment {
  id: string;
  comment_id?: string;
  kind: AttachmentKind;
  url: string;
  label?: string | null;
  created_at?: string;
}

export interface CommentRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  author: string;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** A comment with its attachments and its (single level of) replies. */
export interface CommentNode extends CommentRow {
  attachments: Attachment[];
  replies: CommentNode[];
  /** True while an optimistic write is still waiting on the server. */
  pending?: boolean;
  /** Set when a write failed and the user can retry. */
  failed?: boolean;
}

/** Payload accepted by POST /api/comments. */
export interface CreateCommentInput {
  project_id: string;
  parent_id?: string | null;
  author: string;
  body: string;
  attachments?: Array<{
    kind: AttachmentKind;
    url: string;
    label?: string | null;
  }>;
}

/** Which storage engine the server resolved at runtime. */
export type BackendKind = "supabase" | "neon";

/**
 * Server responses all carry `backend` so the client can show which engine is
 * live, and `code` lets the UI distinguish "not configured" (fall back to
 * localStorage silently) from a real error (show a retry).
 */
export interface ApiError {
  error: string;
  code?: "DB_NOT_CONFIGURED" | "UNAUTHORIZED" | "RATE_LIMITED" | "BAD_REQUEST";
  backend?: BackendKind | "none";
}

/** Detected URL chip metadata. */
export interface LinkChip {
  kind: "drive" | "figma" | "video" | "image" | "notion" | "generic";
  icon: string;
  label: string;
  /** Set only for `kind === "image"`, used for the inline thumbnail. */
  thumbnailUrl?: string;
}
