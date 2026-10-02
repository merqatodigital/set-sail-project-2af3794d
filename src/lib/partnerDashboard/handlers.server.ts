// =============================================================================
// Partner Dashboard — /api route handlers
// =============================================================================
// Wired into the existing Nitro server entry (src/server.ts), alongside
// /api/chat and /api/portal/* — the pattern this repo already uses, rather
// than Vercel-style /api/*.js files which would never execute here.
//
// Routes:
//   POST   /api/session    verify the shared passcode, report the backend
//   GET    /api/projects   seed rows + live comment counts (never needs a DB)
//   GET    /api/comments   one project's threaded comments
//   POST   /api/comments   create a comment or reply
//   PATCH  /api/comments   edit a comment (author only, revision recorded)
//   DELETE /api/comments   soft delete (author only, body preserved in history)
//   POST   /api/upload     validate + store one image
//
// SERVER ONLY.
// =============================================================================

import seedData from "../../../content/updates.json";
import {
  AUTHORS,
  DEFAULT_PASSCODE,
  IMAGE_LIMITS,
  RATE_LIMITS,
} from "./config";
import {
  backendLabel,
  PartnerDbUnavailable,
  resolveDb,
  runtimeValue,
  type PartnerDb,
} from "./db.server";
import { extensionFor, sniffImageType, storeImage } from "./storage.server";
// Imported from sanitize.ts (not attach.ts) so the server bundle never pulls
// in DOMPurify, which is browser-only.
import { sanitizeCommentText } from "./sanitize";
import type {
  Attachment,
  CommentNode,
  CommentRow,
  ProjectRow,
  ProjectSeed,
} from "./types";

const SEED = seedData as ProjectSeed[];
const HOUR_SECONDS = 3600;

// --- Primitives -------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Constant-time string comparison. A plain === leaks the passcode's length and
 * prefix through timing; this does not.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function expectedPasscode(env: unknown): { value: string; isDefault: boolean } {
  const configured = runtimeValue(env, "DASHBOARD_PASSCODE");
  return configured
    ? { value: configured, isDefault: false }
    : { value: DEFAULT_PASSCODE, isDefault: true };
}

let warnedAboutDefault = false;

/**
 * Gate used by every write endpoint. Returns null when the request may
 * proceed, or a Response to send back when it may not.
 */
async function requirePasscode(request: Request, env: unknown): Promise<Response | null> {
  const { value, isDefault } = expectedPasscode(env);

  if (isDefault && !warnedAboutDefault) {
    warnedAboutDefault = true;
    console.warn(
      `[partner-dashboard] DASHBOARD_PASSCODE is not set — using the built-in default "${DEFAULT_PASSCODE}". ` +
        "Set DASHBOARD_PASSCODE in your environment to change it.",
    );
  }

  const provided = request.headers.get("x-dashboard-passcode") ?? "";
  if (!provided) return json({ error: "Passcode required.", code: "UNAUTHORIZED" }, 401);

  // Throttle guesses against the 4-digit default.
  const ip = clientIp(request);
  const db = await safeDb(env);
  if (db) {
    const allowed = await db.rateLimit(
      `passcode:${ip}`,
      RATE_LIMITS.passcodeAttemptsPerHour,
      HOUR_SECONDS,
    );
    if (!allowed) {
      return json(
        { error: "Too many passcode attempts. Try again later.", code: "RATE_LIMITED" },
        429,
      );
    }
  }

  if (!safeEqual(provided, value)) {
    return json({ error: "That passcode is not correct.", code: "UNAUTHORIZED" }, 401);
  }
  return null;
}

function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Resolves the DB, returning null instead of throwing when unconfigured. */
async function safeDb(env: unknown): Promise<PartnerDb | null> {
  try {
    return await resolveDb(env);
  } catch {
    return null;
  }
}

function notConfigured(env: unknown, message: string): Response {
  return json({ error: message, code: "DB_NOT_CONFIGURED", backend: backendLabel(env) }, 503);
}

function normaliseAuthor(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().slice(0, IMAGE_LIMITS.maxAuthorChars) : "";
  if (!value) return "Unknown";
  // Keep the two known authors canonicalised so comparisons work.
  const known = AUTHORS.find((author) => author.toLowerCase() === value.toLowerCase());
  return known ?? value;
}

function parseBody<T>(request: Request): Promise<T | null> {
  return request
    .json()
    .then((value) => value as T)
    .catch(() => null);
}

// --- Seed rows --------------------------------------------------------------

function seedRows(): ProjectSeed[] {
  return Array.isArray(SEED) ? SEED : [];
}

function resolveLastUpdated(row: ProjectSeed, lastCommentAt: string | null): string {
  const candidates = [row.updated, lastCommentAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (!candidates.length) return new Date().toISOString();
  return new Date(Math.max(...candidates.map((date) => date.getTime()))).toISOString();
}

// --- Threading --------------------------------------------------------------

function buildThread(comments: CommentRow[], attachments: Attachment[]): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  for (const comment of comments) {
    byId.set(comment.id, {
      ...comment,
      attachments: attachments.filter((attachment) => attachment.comment_id === comment.id),
      replies: [],
    });
  }

  const roots: CommentNode[] = [];
  for (const comment of comments) {
    const node = byId.get(comment.id)!;
    // Orphans (parent deleted by cascade) are promoted to top level rather
    // than silently dropped.
    const parent = comment.parent_id ? byId.get(comment.parent_id) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

// --- Handlers ---------------------------------------------------------------

/** POST /api/session — verify the passcode and report which backend is live. */
export async function handleSession(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const denial = await requirePasscode(request, env);
  if (denial) return denial;

  const db = await safeDb(env);
  return json({ ok: true, backend: db?.kind ?? backendLabel(env) });
}

/**
 * GET /api/projects — hero table rows.
 * Deliberately works with NO database: the seed file is the source of truth
 * for name/status/url/image, and comment counts are layered on best-effort.
 * That is what makes the site render correctly with zero backend configured.
 */
export async function handleProjects(request: Request, env: unknown): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405);

  const rows = seedRows();
  const counts = new Map<string, { count: number; lastAt: string | null }>();

  const db = await safeDb(env);
  if (db) {
    try {
      const aggregated = await db.countCommentsByProject();
      for (const [projectId, value] of Object.entries(aggregated)) counts.set(projectId, value);
      // Mirror the seed into the projects table so comments' FK (and the
      // admin/DB view) always has a matching parent row. Best-effort only.
      await db.upsertProjects(rows).catch((error) => {
        console.warn("[partner-dashboard] could not mirror seed rows into projects:", error);
      });
    } catch (error) {
      console.warn("[partner-dashboard] comment counts unavailable:", error);
    }
  }

  const data: ProjectRow[] = rows.map((row) => {
    const stats = counts.get(row.id);
    return {
      ...row,
      comment_count: stats?.count ?? 0,
      last_comment_at: stats?.lastAt ?? null,
      last_updated: resolveLastUpdated(row, stats?.lastAt ?? null),
    };
  });

  return json({ data, backend: db?.kind ?? backendLabel(env) });
}

/** GET /api/comments?project_id=… */
export async function handleCommentsGet(request: Request, env: unknown): Promise<Response> {
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!projectId) return json({ error: "project_id is required", code: "BAD_REQUEST" }, 400);

  const db = await safeDb(env);
  if (!db) {
    return notConfigured(
      env,
      "No database is configured yet. Comments are being saved in your browser only.",
    );
  }

  try {
    const { comments, attachments } = await db.listComments(projectId);
    return json({ data: buildThread(comments, attachments), backend: db.kind });
  } catch (error) {
    console.error("[partner-dashboard] list comments failed:", error);
    return json(
      { error: (error as Error).message, code: "DB_NOT_CONFIGURED", backend: db.kind },
      503,
    );
  }
}

/** POST /api/comments — create a comment or a one-level reply. */
export async function handleCommentsPost(request: Request, env: unknown): Promise<Response> {
  const denial = await requirePasscode(request, env);
  if (denial) return denial;

  const body = await parseBody<{
    project_id?: string;
    parent_id?: string | null;
    author?: string;
    body?: string;
    attachments?: Array<{ kind?: string; url?: string; label?: string }>;
  }>(request);
  if (!body) return json({ error: "invalid JSON body", code: "BAD_REQUEST" }, 400);

  // Validated against the seed file, which needs no database — so a bad
  // project id reports 400 even when no backend is configured.
  const projectId = typeof body.project_id === "string" ? body.project_id : "";
  if (!projectId || !seedRows().some((row) => row.id === projectId)) {
    return json({ error: "Unknown project_id.", code: "BAD_REQUEST" }, 400);
  }

  const db = await safeDb(env);
  if (!db) {
    return notConfigured(env, "No database is configured yet. Saving locally instead.");
  }

  const text = sanitizeCommentText(String(body.body ?? ""), IMAGE_LIMITS.maxCommentChars);
  const attachments = (body.attachments ?? [])
    .filter((attachment) => typeof attachment?.url === "string" && attachment.url.length < 200_000)
    .slice(0, IMAGE_LIMITS.maxImagesPerComment + IMAGE_LIMITS.maxLinksPerComment)
    .map((attachment) => ({
      kind: attachment.kind === "image" ? ("image" as const) : ("link" as const),
      url: String(attachment.url),
      label: attachment.label ? String(attachment.label).slice(0, 60) : null,
    }));

  if (!text && !attachments.length) {
    return json({ error: "A comment needs text or an attachment.", code: "BAD_REQUEST" }, 400);
  }

  // One level of replies only: a parent must itself be top-level.
  let parentId: string | null = null;
  if (body.parent_id) {
    try {
      const parent = (await db.listComments(projectId)).comments.find(
        (row) => row.id === body.parent_id,
      );
      if (!parent) return json({ error: "Parent comment not found.", code: "BAD_REQUEST" }, 400);
      if (parent.parent_id) {
        return json({ error: "Replies can only be one level deep.", code: "BAD_REQUEST" }, 400);
      }
      parentId = parent.id;
    } catch {
      return json({ error: "Could not verify the parent comment.", code: "BAD_REQUEST" }, 400);
    }
  }

  const allowed = await db.rateLimit(
    `comment:${clientIp(request)}`,
    RATE_LIMITS.commentsPerHour,
    HOUR_SECONDS,
  );
  if (!allowed) {
    return json(
      {
        error: `Rate limit reached (${RATE_LIMITS.commentsPerHour} comments per hour). Try again later.`,
        code: "RATE_LIMITED",
      },
      429,
    );
  }

  try {
    const created = await db.createComment({
      projectId,
      parentId,
      author: normaliseAuthor(body.author),
      body: text,
      attachments,
    });
    const node: CommentNode = {
      ...created.comment,
      attachments: created.attachments,
      replies: [],
    };
    return json({ data: node, backend: db.kind }, 201);
  } catch (error) {
    console.error("[partner-dashboard] create comment failed:", error);
    return json({ error: (error as Error).message, backend: db.kind }, 500);
  }
}

/**
 * PATCH /api/comments?id=…
 * Author-only, and the replaced body is written to comment_revisions first.
 */
export async function handleCommentsPatch(request: Request, env: unknown): Promise<Response> {
  const denial = await requirePasscode(request, env);
  if (denial) return denial;

  const db = await safeDb(env);
  if (!db) return notConfigured(env, "No database is configured yet.");

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "id is required", code: "BAD_REQUEST" }, 400);

  const body = await parseBody<{ body?: string; author?: string }>(request);
  if (!body) return json({ error: "invalid JSON body", code: "BAD_REQUEST" }, 400);

  const text = sanitizeCommentText(String(body.body ?? ""), IMAGE_LIMITS.maxCommentChars);
  if (!text) return json({ error: "A comment cannot be empty.", code: "BAD_REQUEST" }, 400);

  const author = normaliseAuthor(body.author);
  try {
    // Ownership is checked BEFORE any write, so a rejected edit can never
    // mutate the row or leave a stray revision behind.
    const existing = await db.getComment(id);
    if (!existing || existing.deleted_at) {
      return json({ error: "Comment not found.", code: "BAD_REQUEST" }, 404);
    }
    if (existing.author !== author) {
      return json({ error: "You can only edit your own comments.", code: "UNAUTHORIZED" }, 403);
    }

    const updated = await db.updateComment(id, text, author);
    if (!updated) return json({ error: "Comment not found.", code: "BAD_REQUEST" }, 404);
    return json({ data: updated, backend: db.kind });
  } catch (error) {
    console.error("[partner-dashboard] update comment failed:", error);
    return json({ error: (error as Error).message, backend: db.kind }, 500);
  }
}

/** DELETE /api/comments?id=…&author=… — soft delete, body cleared, row kept. */
export async function handleCommentsDelete(request: Request, env: unknown): Promise<Response> {
  const denial = await requirePasscode(request, env);
  if (denial) return denial;

  const db = await safeDb(env);
  if (!db) return notConfigured(env, "No database is configured yet.");

  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const authorRaw = params.get("author");
  if (!id || !authorRaw) {
    return json({ error: "id and author are required", code: "BAD_REQUEST" }, 400);
  }
  const author = normaliseAuthor(authorRaw);

  try {
    // Ownership first — a soft delete is still a destructive write.
    const existing = await db.getComment(id);
    if (!existing || existing.deleted_at) {
      return json({ error: "Comment not found.", code: "BAD_REQUEST" }, 404);
    }
    if (existing.author !== author) {
      return json({ error: "You can only delete your own comments.", code: "UNAUTHORIZED" }, 403);
    }

    const removed = await db.softDeleteComment(id, author);
    if (!removed) return json({ error: "Comment not found.", code: "BAD_REQUEST" }, 404);
    return json({ data: null, backend: db.kind });
  } catch (error) {
    console.error("[partner-dashboard] delete comment failed:", error);
    return json({ error: (error as Error).message, backend: db.kind }, 500);
  }
}

/**
 * POST /api/upload — raw image bytes in the body.
 * Validates the passcode, the rate limit, the declared size and the REAL
 * content type (magic bytes), then stores the file.
 */
export async function handleUpload(request: Request, env: unknown): Promise<Response> {
  const denial = await requirePasscode(request, env);
  if (denial) return denial;

  const declared = Number(request.headers.get("x-content-length") || 0);
  if (declared > IMAGE_LIMITS.maxBytesPerImage) {
    return json(
      {
        error: `Images must be under ${Math.round(IMAGE_LIMITS.maxBytesPerImage / 1024 / 1024)} MB.`,
        code: "BAD_REQUEST",
      },
      413,
    );
  }

  const db = await safeDb(env);
  // A missing DB is not fatal here: the base64 tier can still succeed.

  const allowed = await db?.rateLimit(
    `upload:${clientIp(request)}`,
    RATE_LIMITS.uploadsPerHour,
    HOUR_SECONDS,
  );
  if (allowed === false) {
    return json(
      {
        error: `Rate limit reached (${RATE_LIMITS.uploadsPerHour} uploads per hour). Try again later.`,
        code: "RATE_LIMITED",
      },
      429,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return json({ error: "Could not read the upload.", code: "BAD_REQUEST" }, 400);
  }

  if (!bytes.byteLength) return json({ error: "Empty upload.", code: "BAD_REQUEST" }, 400);
  if (bytes.byteLength > IMAGE_LIMITS.maxBytesPerImage) {
    return json({ error: "Image is too large.", code: "BAD_REQUEST" }, 413);
  }

  // Trust the bytes, never the header or the filename.
  const mime = sniffImageType(bytes);
  if (!mime) {
    return json(
      { error: "That file is not a recognised image (JPEG, PNG, WebP, GIF or AVIF).", code: "BAD_REQUEST" },
      415,
    );
  }

  const projectId = request.headers.get("x-project-id") || "unsorted";
  const safeProject = projectId.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 60) || "unsorted";
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${safeProject}/${new Date().toISOString().slice(0, 10)}/${unique}.${extensionFor(mime)}`;

  try {
    const stored = await storeImage(env, db, bytes, mime, path);
    return json({ data: { url: stored.url, base64: stored.base64 }, backend: db?.kind ?? "none" });
  } catch (error) {
    console.error("[partner-dashboard] upload failed:", error);
    return json(
      { error: (error as Error).message, code: "DB_NOT_CONFIGURED", backend: db?.kind ?? "none" },
      503,
    );
  }
}

/** Re-exported so src/server.ts can catch it without importing db.server. */
export { PartnerDbUnavailable };
