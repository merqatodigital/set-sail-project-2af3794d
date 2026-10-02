// =============================================================================
// Partner Dashboard — database adapter (Supabase primary, Neon fallback)
// =============================================================================
// Selection logic, exactly as specced:
//   1. Read SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY /
//      NEON_DATABASE_URL from the runtime environment.
//   2. Supabase vars present AND a test query succeeds → Supabase.
//   3. Else NEON_DATABASE_URL present → Neon via @neondatabase/serverless.
//   4. Else → throw PartnerDbUnavailable; /api answers 503 DB_NOT_CONFIGURED
//      and the frontend switches to localStorage-only mode.
//
// The resolved backend is cached in a module-level promise and logged once,
// so deploy logs show which engine is live without repeating on every request.
//
// SERVER ONLY — never import this from client code.
// =============================================================================

import { STORAGE_BUCKET } from "./config";
import type {
  Attachment,
  AttachmentKind,
  BackendKind,
  CommentRow,
  ProjectSeed,
} from "./types";

/** Thrown when no backend is configured or reachable. */
export class PartnerDbUnavailable extends Error {
  code = "DB_NOT_CONFIGURED" as const;
  constructor(message: string) {
    super(message);
    this.name = "PartnerDbUnavailable";
  }
}

/**
 * How long a probe may take before the adapter gives up and moves to the next
 * backend. Without this, a hanging Supabase would stall every /api request
 * instead of degrading to localStorage.
 */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * After a failed probe, refuse to probe again for this long. Serverless
 * instances stay warm between requests, so without a negative cache a backend
 * outage turns every single request into a 5s stall.
 */
const FAILURE_TTL_MS = 30_000;

/** Signatures of a transport failure, as opposed to a SQL/PostgREST error. */
const NETWORK_FAILURE =
  /fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|timed out|getaddrinfo/i;

function withTimeout<T>(thenable: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms,
    );
    thenable.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Reads a binding from the Nitro/Cloudflare `env` object first (that is how
 * secrets arrive on Workers), then falls back to process.env for Node.
 * Mirrors the existing runtimeValue() helper in src/server.ts.
 */
export function runtimeValue(env: unknown, name: string): string {
  const runtime =
    env && typeof env === "object" ? (env as Record<string, unknown>)[name] : undefined;
  if (typeof runtime === "string" && runtime) return runtime;
  return typeof process !== "undefined" ? (process.env[name] ?? "") : "";
}

export interface NewComment {
  projectId: string;
  parentId: string | null;
  author: string;
  body: string;
  attachments: Array<{ kind: AttachmentKind; url: string; label?: string | null }>;
}

export interface PartnerDb {
  kind: BackendKind;
  /** True when writes run with a privileged key rather than the public one. */
  privileged: boolean;
  /** Single-comment lookup, used for author ownership checks before writes. */
  getComment(id: string): Promise<CommentRow | null>;
  listComments(projectId: string): Promise<{ comments: CommentRow[]; attachments: Attachment[] }>;
  createComment(input: NewComment): Promise<{ comment: CommentRow; attachments: Attachment[] }>;
  updateComment(id: string, body: string, editedBy: string): Promise<CommentRow | null>;
  softDeleteComment(id: string, author: string): Promise<boolean>;
  countCommentsByProject(): Promise<Record<string, { count: number; lastAt: string | null }>>;
  rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean>;
  /** Best-effort mirror of the seed rows into the projects table. */
  upsertProjects(rows: ProjectSeed[]): Promise<void>;
  /** Uploads bytes and returns a public URL. Absent when unsupported. */
  uploadImage?(bytes: Uint8Array, contentType: string, path: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

async function trySupabase(env: unknown): Promise<PartnerDb | null> {
  const url = runtimeValue(env, "SUPABASE_URL") || runtimeValue(env, "VITE_SUPABASE_URL");
  const serviceKey = runtimeValue(env, "SUPABASE_SERVICE_KEY");
  const anonKey =
    runtimeValue(env, "SUPABASE_ANON_KEY") ||
    runtimeValue(env, "SUPABASE_PUBLISHABLE_KEY") ||
    runtimeValue(env, "VITE_SUPABASE_PUBLISHABLE_KEY");

  const key = serviceKey || anonKey;
  if (!url || !key) {
    console.log(
      "[partner-dashboard] Supabase not configured (need SUPABASE_URL + SUPABASE_ANON_KEY or SUPABASE_SERVICE_KEY)",
    );
    return null;
  }

  let client: import("@supabase/supabase-js").SupabaseClient;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (error) {
    console.error("[partner-dashboard] Supabase client failed to initialise:", error);
    return null;
  }

  // Test query — the gate from step 2 of the spec.
  try {
    const { error } = await withTimeout(
      client.from("projects").select("id").limit(1),
      PROBE_TIMEOUT_MS,
      "Supabase test query",
    );
    if (error) {
      // Distinguish "cannot reach the host" from "the table is missing".
      // Telling someone to run the migration when the real problem is DNS
      // sends them down the wrong path.
      if (NETWORK_FAILURE.test(error.message ?? "")) {
        console.error(
          `[partner-dashboard] Supabase could not be reached (${error.message}). ` +
            "Check SUPABASE_URL and outbound network access.",
        );
      } else {
        console.error(
          `[partner-dashboard] Supabase reachable but the test query failed (${error.message}). ` +
            "Run supabase/migrations/20261002000000_partner_dashboard.sql to create the tables.",
        );
      }
      return null;
    }
  } catch (error) {
    console.error(
      `[partner-dashboard] Supabase test query failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  if (!serviceKey) {
    console.warn(
      "[partner-dashboard] Writing with the PUBLIC Supabase key — the passcode gate is " +
        "enforced at /api but is not enforced by Postgres. Set SUPABASE_SERVICE_KEY and run " +
        "20261002000100_partner_dashboard_hardening.sql to close that gap.",
    );
  }

  console.log(
    `[partner-dashboard] active backend: supabase (${serviceKey ? "service key" : "public key"})`,
  );

  const db: PartnerDb = {
    kind: "supabase",
    privileged: Boolean(serviceKey),

    async getComment(id) {
      const { data, error } = await client
        .from("comments")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as CommentRow) ?? null;
    },

    async listComments(projectId) {
      const { data: comments, error } = await client
        .from("comments")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (comments ?? []) as CommentRow[];
      if (!rows.length) return { comments: [], attachments: [] };

      const { data: attachments, error: attachmentError } = await client
        .from("attachments")
        .select("*")
        .in(
          "comment_id",
          rows.map((row) => row.id),
        );
      if (attachmentError) throw new Error(attachmentError.message);
      return { comments: rows, attachments: (attachments ?? []) as Attachment[] };
    },

    async createComment(input) {
      const { data: comment, error } = await client
        .from("comments")
        .insert({
          project_id: input.projectId,
          parent_id: input.parentId,
          author: input.author,
          body: input.body,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      let attachments: Attachment[] = [];
      if (input.attachments.length) {
        const { data, error: attachmentError } = await client
          .from("attachments")
          .insert(
            input.attachments.map((attachment) => ({
              comment_id: comment.id,
              kind: attachment.kind,
              url: attachment.url,
              label: attachment.label ?? null,
            })),
          )
          .select("*");
        if (attachmentError) throw new Error(attachmentError.message);
        attachments = (data ?? []) as Attachment[];
      }
      return { comment: comment as CommentRow, attachments };
    },

    async updateComment(id, body, editedBy) {
      // Preserve the previous revision first, so the audit trail is written
      // even if the UPDATE itself then fails.
      const { data: existing } = await client
        .from("comments")
        .select("body")
        .eq("id", id)
        .maybeSingle();

      if (existing?.body) {
        await client
          .from("comment_revisions")
          .insert({ comment_id: id, body: existing.body, edited_by: editedBy });
      }

      const { data, error } = await client
        .from("comments")
        .update({ body, updated_at: new Date().toISOString() })
        .eq("id", id)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as CommentRow) ?? null;
    },

    async softDeleteComment(id, author) {
      const { data, error } = await client
        .from("comments")
        .update({ deleted_at: new Date().toISOString(), body: "" })
        .eq("id", id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return Boolean(data);
    },

    async countCommentsByProject() {
      const { data, error } = await client
        .from("comments")
        .select("project_id, created_at")
        .is("deleted_at", null);
      if (error) throw new Error(error.message);

      const out: Record<string, { count: number; lastAt: string | null }> = {};
      for (const row of (data ?? []) as Array<{ project_id: string; created_at: string }>) {
        const entry = out[row.project_id] ?? { count: 0, lastAt: null };
        entry.count += 1;
        if (!entry.lastAt || new Date(row.created_at) > new Date(entry.lastAt)) {
          entry.lastAt = row.created_at;
        }
        out[row.project_id] = entry;
      }
      return out;
    },

    async rateLimit(key, max, windowSeconds) {
      const { data, error } = await client.rpc("check_write_rate_limit", {
        p_key: key,
        p_max: max,
        p_window: `${windowSeconds} seconds`,
      });
      if (error) {
        // Never let a rate-limiter outage block legitimate writes; log instead.
        console.error("[partner-dashboard] rate limit check failed:", error.message);
        return true;
      }
      return data !== false;
    },

    async upsertProjects(rows) {
      const { error } = await client.from("projects").upsert(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          url: row.url ?? null,
          image: row.image ?? null,
          updated_at: row.updated ? new Date(row.updated).toISOString() : new Date().toISOString(),
        })),
        { onConflict: "id" },
      );
      if (error) throw new Error(error.message);
    },

    async uploadImage(bytes, contentType, path) {
      const { error } = await client.storage
        .from(STORAGE_BUCKET)
        .upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(error.message);
      const { data } = client.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    },
  };

  return db;
}

// ---------------------------------------------------------------------------
// Neon
// ---------------------------------------------------------------------------

async function tryNeon(env: unknown): Promise<PartnerDb | null> {
  const connectionString = runtimeValue(env, "NEON_DATABASE_URL");
  if (!connectionString) {
    console.log("[partner-dashboard] Neon not configured (no NEON_DATABASE_URL)");
    return null;
  }

  // A tagged-template function is exactly what neon() returns; typing it this
  // way lets `sql`…`` be called with full type safety and no casts.
  type SqlFn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<Array<Record<string, unknown>>>;

  let run: SqlFn;
  try {
    const { neon } = await import("@neondatabase/serverless");
    run = neon(connectionString) as unknown as SqlFn;
    // Test query, step 3 of the spec — bounded so a hanging host cannot stall
    // the request indefinitely.
    await withTimeout(run`select 1`, PROBE_TIMEOUT_MS, "Neon connection");
  } catch (error) {
    console.error(
      `[partner-dashboard] Neon connection failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  console.log("[partner-dashboard] active backend: neon");

  const mapComment = (row: Record<string, unknown>): CommentRow => ({
    id: String(row.id),
    project_id: String(row.project_id ?? ""),
    parent_id: row.parent_id ? String(row.parent_id) : null,
    author: String(row.author ?? ""),
    body: String(row.body ?? ""),
    created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
    deleted_at: row.deleted_at ? new Date(row.deleted_at as string).toISOString() : null,
  });

  const mapAttachment = (row: Record<string, unknown>): Attachment => ({
    id: String(row.id),
    comment_id: row.comment_id ? String(row.comment_id) : undefined,
    kind: (row.kind === "image" ? "image" : "link") as AttachmentKind,
    url: String(row.url ?? ""),
    label: row.label ? String(row.label) : null,
    created_at: row.created_at ? new Date(row.created_at as string).toISOString() : undefined,
  });

  return {
    kind: "neon",
    privileged: true,

    async getComment(id) {
      const rows = await run`select * from comments where id = ${id}::uuid`;
      return rows.length ? mapComment(rows[0]) : null;
    },

    async listComments(projectId) {
      const comments = await run`
        select * from comments
        where project_id = ${projectId}
        order by created_at asc
      `;
      const rows = comments.map(mapComment);
      if (!rows.length) return { comments: [], attachments: [] };

      const attachments = await run`
        select * from attachments
        where comment_id = any(${rows.map((row) => row.id)}::uuid[])
      `;
      return { comments: rows, attachments: attachments.map(mapAttachment) };
    },

    async createComment(input) {
      const inserted = await run`
        insert into comments (project_id, parent_id, author, body)
        values (
          ${input.projectId},
          ${input.parentId}::uuid,
          ${input.author},
          ${input.body}
        )
        returning *
      `;
      const comment = mapComment(inserted[0]);

      let attachments: Attachment[] = [];
      for (const attachment of input.attachments) {
        const rows = await run`
          insert into attachments (comment_id, kind, url, label)
          values (${comment.id}::uuid, ${attachment.kind}, ${attachment.url}, ${attachment.label ?? null})
          returning *
        `;
        attachments = [...attachments, mapAttachment(rows[0])];
      }
      return { comment, attachments };
    },

    async updateComment(id, body, editedBy) {
      const existing = await run`
        select body from comments where id = ${id}::uuid and deleted_at is null
      `;
      if (existing.length) {
        await run`
          insert into comment_revisions (comment_id, body, edited_by)
          values (${id}::uuid, ${String(existing[0].body ?? "")}, ${editedBy})
        `;
      }

      const updated = await run`
        update comments
        set body = ${body}, updated_at = now()
        where id = ${id}::uuid and deleted_at is null
        returning *
      `;
      return updated.length ? mapComment(updated[0]) : null;
    },

    async softDeleteComment(id) {
      const rows = await run`
        update comments
        set deleted_at = now(), body = ''
        where id = ${id}::uuid
        returning id
      `;
      return rows.length > 0;
    },

    async countCommentsByProject() {
      const rows = await run`
        select project_id, count(*)::int as count, max(created_at) as last_at
        from comments
        where deleted_at is null
        group by project_id
      `;
      const out: Record<string, { count: number; lastAt: string | null }> = {};
      for (const row of rows) {
        out[String(row.project_id)] = {
          count: Number(row.count ?? 0),
          lastAt: row.last_at ? new Date(row.last_at as string).toISOString() : null,
        };
      }
      return out;
    },

    async rateLimit(key, max, windowSeconds) {
      try {
        const rows = await run`
          select check_write_rate_limit(${key}, ${max}, ${`${windowSeconds} seconds`}::interval) as allowed
        `;
        return rows[0]?.allowed !== false;
      } catch (error) {
        console.error("[partner-dashboard] rate limit check failed:", error);
        return true;
      }
    },

    async upsertProjects(rows) {
      for (const row of rows) {
        await run`
          insert into projects (id, name, status, url, image, updated_at)
          values (
            ${row.id},
            ${row.name},
            ${row.status},
            ${row.url ?? null},
            ${row.image ?? null},
            ${row.updated ? new Date(row.updated).toISOString() : new Date().toISOString()}::timestamptz
          )
          on conflict (id) do update
            set name = excluded.name,
                status = excluded.status,
                url = excluded.url,
                image = excluded.image,
                updated_at = excluded.updated_at
        `;
      }
    },

    // No uploadImage: Neon is database-only. Images go to Vercel Blob, or
    // fall back to base64-in-DB for small files. See storage.server.ts.
  };
}

// ---------------------------------------------------------------------------
// Resolution + boot logging
// ---------------------------------------------------------------------------

let cached: Promise<PartnerDb> | null = null;
let lastFailureAt = 0;

const UNAVAILABLE_MESSAGE =
  "No database is configured. Set SUPABASE_URL + SUPABASE_ANON_KEY, or NEON_DATABASE_URL.";

/** Runs the probes once, in priority order. */
async function probeBackends(env: unknown): Promise<PartnerDb> {
  const supabase = await trySupabase(env);
  if (supabase) return supabase;

  const neonDb = await tryNeon(env);
  if (neonDb) return neonDb;

  console.error(
    "[partner-dashboard] No database configured. Set SUPABASE_URL + SUPABASE_ANON_KEY " +
      "(and ideally SUPABASE_SERVICE_KEY), or NEON_DATABASE_URL. " +
      "The dashboard will run in localStorage-only mode.",
  );
  throw new PartnerDbUnavailable(UNAVAILABLE_MESSAGE);
}

/** Resolves (and caches) the active backend. Throws PartnerDbUnavailable. */
export function resolveDb(env: unknown): Promise<PartnerDb> {
  if (cached) return cached;

  // Negative cache: fail fast for FAILURE_TTL_MS after a failed probe, so a
  // backend outage does not cost every request a full timeout. After the TTL
  // we probe again, which also picks up env vars added by a redeploy.
  if (lastFailureAt && Date.now() - lastFailureAt < FAILURE_TTL_MS) {
    return Promise.reject(new PartnerDbUnavailable(UNAVAILABLE_MESSAGE));
  }

  const attempt = probeBackends(env);
  cached = attempt;

  // Attaching a handler here marks the rejection as observed (no unhandled
  // rejection noise) and schedules the retry. `cached` still rejects for
  // callers, so callers keep their own error handling.
  attempt.catch(() => {
    if (cached === attempt) cached = null;
    lastFailureAt = Date.now();
  });

  return attempt;
}

/** Clears the resolved backend. Exposed for tests. */
export function resetDbCache(): void {
  cached = null;
  lastFailureAt = 0;
}

/** Cheap backend label for responses, without forcing a connection. */
export function backendLabel(env: unknown): BackendKind | "none" {
  const url = runtimeValue(env, "SUPABASE_URL") || runtimeValue(env, "VITE_SUPABASE_URL");
  const key =
    runtimeValue(env, "SUPABASE_SERVICE_KEY") ||
    runtimeValue(env, "SUPABASE_ANON_KEY") ||
    runtimeValue(env, "SUPABASE_PUBLISHABLE_KEY") ||
    runtimeValue(env, "VITE_SUPABASE_PUBLISHABLE_KEY");
  if (url && key) return "supabase";
  if (runtimeValue(env, "NEON_DATABASE_URL")) return "neon";
  return "none";
}
