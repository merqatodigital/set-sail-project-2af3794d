// =============================================================================
// Partner Dashboard — client data layer
// =============================================================================
// One place where the UI talks to /api. Responsibilities:
//   • attach the passcode header to every write
//   • optimistic create / edit / delete, reconciled with the server
//   • fall back to localStorage (and flag "offline") when the backend is
//     unreachable or not configured
//   • replay the outbox automatically once the server is reachable again
// =============================================================================

import { API, IMAGE_LIMITS, STORAGE_BUCKET } from "./config";
import { getPasscode } from "./profile";
import {
  addLocalComment,
  clearLocalComment,
  markLocalFailed,
  markLocalPending,
  mergeServerWithPending,
  newLocalId,
  queueOp,
  readLocalComments,
  readOutbox,
  removeOp,
  softDeleteLocalComment,
  updateLocalComment,
  updateOp,
  writeLocalComments,
} from "./local";
import type {
  BackendKind,
  CommentNode,
  CreateCommentInput,
  ProjectRow,
} from "./types";

export interface Result<T> {
  data: T | null;
  /** True when the browser is serving from localStorage instead of the server. */
  offline: boolean;
  backend: BackendKind | "none";
  error?: string;
  code?: string;
}

// --- Offline flag (pub/sub so the banner can react) -------------------------

let offline = false;
const listeners = new Set<(offline: boolean) => void>();

export function isOffline(): boolean {
  return offline;
}

export function subscribeOffline(listener: (offline: boolean) => void): () => void {
  listeners.add(listener);
  listener(offline);
  return () => listeners.delete(listener);
}

function setOffline(next: boolean): void {
  if (offline === next) return;
  offline = next;
  listeners.forEach((listener) => listener(next));
}

// --- Fetch helpers ----------------------------------------------------------

function writeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const passcode = getPasscode();
  return {
    "content-type": "application/json",
    ...(passcode ? { "x-dashboard-passcode": passcode } : {}),
    ...extra,
  };
}

interface ServerEnvelope<T> {
  data?: T;
  backend?: BackendKind | "none";
  error?: string;
  code?: string;
}

async function parse<T>(response: Response): Promise<ServerEnvelope<T>> {
  try {
    return (await response.json()) as ServerEnvelope<T>;
  } catch {
    return { error: `Unexpected response (HTTP ${response.status})` };
  }
}

/** A response that means "server is fine, but there is no database wired up". */
function isNotConfigured(status: number, code?: string): boolean {
  return status === 503 || code === "DB_NOT_CONFIGURED";
}

// --- Passcode gate ----------------------------------------------------------

export async function verifyPasscode(passcode: string): Promise<{
  ok: boolean;
  backend: BackendKind | "none";
  error?: string;
}> {
  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-dashboard-passcode": passcode },
      body: JSON.stringify({}),
    });
    const payload = await parse<never>(response);
    if (response.ok) return { ok: true, backend: payload.backend ?? "none" };
    return {
      ok: false,
      backend: payload.backend ?? "none",
      error: payload.error || "That passcode was not accepted.",
    };
  } catch {
    // No server at all (e.g. `vite dev` without the server entry). The UI
    // still works locally, so treat it as a soft pass rather than a wall.
    return { ok: true, backend: "none", error: "Server unreachable — running locally." };
  }
}

// --- Projects ---------------------------------------------------------------

export async function fetchProjects(): Promise<Result<ProjectRow[]>> {
  try {
    const response = await fetch(API.projects, { headers: { accept: "application/json" } });
    const payload = await parse<ProjectRow[]>(response);

    if (response.ok && payload.data) {
      setOffline(false);
      return { data: payload.data, offline: false, backend: payload.backend ?? "none" };
    }
    if (isNotConfigured(response.status, payload.code)) {
      setOffline(true);
      return { data: null, offline: true, backend: payload.backend ?? "none", code: payload.code };
    }
    return {
      data: null,
      offline: false,
      backend: payload.backend ?? "none",
      error: payload.error || "Could not load projects.",
    };
  } catch (error) {
    setOffline(true);
    return { data: null, offline: true, backend: "none", error: (error as Error).message };
  }
}

// --- Comments ---------------------------------------------------------------

export async function fetchComments(projectId: string): Promise<Result<CommentNode[]>> {
  try {
    const response = await fetch(
      `${API.comments}?project_id=${encodeURIComponent(projectId)}`,
      { headers: { accept: "application/json" } },
    );
    const payload = await parse<CommentNode[]>(response);

    if (response.ok && payload.data) {
      setOffline(false);
      const merged = mergeServerWithPending(payload.data, readLocalComments(projectId));
      writeLocalComments(projectId, merged);
      return { data: merged, offline: false, backend: payload.backend ?? "none" };
    }
    if (isNotConfigured(response.status, payload.code)) {
      setOffline(true);
      return {
        data: readLocalComments(projectId),
        offline: true,
        backend: payload.backend ?? "none",
        code: payload.code,
      };
    }
    // A real server error: keep showing whatever we have locally.
    setOffline(true);
    return {
      data: readLocalComments(projectId),
      offline: true,
      backend: payload.backend ?? "none",
      error: payload.error,
    };
  } catch (error) {
    setOffline(true);
    return {
      data: readLocalComments(projectId),
      offline: true,
      backend: "none",
      error: (error as Error).message,
    };
  }
}

/** Optimistically inserts a comment, then posts it. Never throws. */
export async function createComment(
  projectId: string,
  input: Omit<CreateCommentInput, "project_id">,
): Promise<Result<CommentNode>> {
  const tempId = newLocalId();
  const payload: CreateCommentInput = { ...input, project_id: projectId };

  addLocalComment(projectId, payload, tempId);
  const opId = newLocalId("op");
  queueOp({ id: opId, kind: "create", tempId, projectId, payload });

  const delivered = await deliverCreate(opId, tempId, projectId, payload);
  return {
    data: delivered.node,
    offline: delivered.offline,
    backend: delivered.backend,
    error: delivered.error,
  };
}

async function deliverCreate(
  opId: string,
  tempId: string,
  projectId: string,
  payload: CreateCommentInput,
): Promise<{
  node: CommentNode | null;
  offline: boolean;
  backend: BackendKind | "none";
  error?: string;
  code?: string;
}> {
  try {
    const response = await fetch(API.comments, {
      method: "POST",
      headers: writeHeaders(),
      body: JSON.stringify(payload),
    });
    const body = await parse<CommentNode>(response);

    if (response.ok && body.data) {
      removeOp(opId);
      // Replace the optimistic node with the server's authoritative copy.
      const nodes = readLocalComments(projectId);
      const replaced = replaceNode(nodes, tempId, { ...body.data, replies: [] });
      writeLocalComments(projectId, replaced);
      setOffline(false);
      return { node: body.data, offline: false, backend: body.backend ?? "none" };
    }

    if (isNotConfigured(response.status, body.code)) {
      setOffline(true);
      return {
        node: null,
        offline: true,
        backend: body.backend ?? "none",
        code: body.code,
        error: body.error,
      };
    }

    // A rejected write (bad passcode, rate limit, validation): flag the node so
    // the UI can show a retry, and keep it in the outbox.
    markLocalFailed(projectId, tempId);
    if (response.status === 401) removeOp(opId); // Retrying without a new passcode is futile.
    return {
      node: null,
      offline: false,
      backend: body.backend ?? "none",
      error: body.error || "Could not post that comment.",
    };
  } catch (error) {
    markLocalFailed(projectId, tempId);
    setOffline(true);
    return { node: null, offline: true, backend: "none", error: (error as Error).message };
  }
}

function replaceNode(nodes: CommentNode[], targetId: string, replacement: CommentNode): CommentNode[] {
  return nodes.map((node) => {
    if (node.id === targetId) return { ...replacement, replies: node.replies ?? [] };
    if (node.replies?.length) {
      const replies = node.replies.map((reply) =>
        reply.id === targetId ? { ...replacement, replies: reply.replies ?? [] } : reply,
      );
      return { ...node, replies };
    }
    return node;
  });
}

export async function updateComment(
  projectId: string,
  commentId: string,
  body: string,
  author: string,
): Promise<Result<null>> {
  updateLocalComment(projectId, commentId, body);
  const opId = newLocalId("op");
  queueOp({ id: opId, kind: "update", commentId, projectId, body, author });

  // An unsent comment only exists locally — nothing to sync.
  if (commentId.startsWith("local-")) {
    removeOp(opId);
    return { data: null, offline: true, backend: "none" };
  }

  try {
    const response = await fetch(`${API.comments}?id=${encodeURIComponent(commentId)}`, {
      method: "PATCH",
      headers: writeHeaders(),
      body: JSON.stringify({ body, author }),
    });
    const payload = await parse<CommentNode>(response);
    if (response.ok) {
      removeOp(opId);
      setOffline(false);
      return { data: null, offline: false, backend: payload.backend ?? "none" };
    }
    return {
      data: null,
      offline: false,
      backend: payload.backend ?? "none",
      error: payload.error || "Could not save that edit.",
      code: payload.code,
    };
  } catch (error) {
    setOffline(true);
    return { data: null, offline: true, backend: "none", error: (error as Error).message };
  }
}

export async function deleteComment(
  projectId: string,
  commentId: string,
  author: string,
): Promise<Result<null>> {
  softDeleteLocalComment(projectId, commentId);
  const opId = newLocalId("op");
  queueOp({ id: opId, kind: "delete", commentId, projectId, author });

  if (commentId.startsWith("local-")) {
    clearLocalComment(projectId, commentId);
    removeOp(opId);
    return { data: null, offline: true, backend: "none" };
  }

  try {
    const response = await fetch(
      `${API.comments}?id=${encodeURIComponent(commentId)}&author=${encodeURIComponent(author)}`,
      { method: "DELETE", headers: writeHeaders() },
    );
    const payload = await parse<null>(response);
    if (response.ok) {
      removeOp(opId);
      setOffline(false);
      return { data: null, offline: false, backend: payload.backend ?? "none" };
    }
    return {
      data: null,
      offline: false,
      backend: payload.backend ?? "none",
      error: payload.error || "Could not delete that comment.",
      code: payload.code,
    };
  } catch (error) {
    setOffline(true);
    return { data: null, offline: true, backend: "none", error: (error as Error).message };
  }
}

/** Retries one failed optimistic comment by replaying it from the outbox. */
export async function retryComment(projectId: string, tempId: string): Promise<Result<null>> {
  const op = readOutbox().find((entry) => entry.kind === "create" && entry.tempId === tempId);
  if (!op || op.kind !== "create") {
    return { data: null, offline: true, backend: "none", error: "Nothing left to retry." };
  }
  markLocalPending(projectId, tempId);
  const delivered = await deliverCreate(op.id, tempId, projectId, op.payload);
  return {
    data: null,
    offline: delivered.offline,
    backend: delivered.backend,
    error: delivered.error,
  };
}

/**
 * Replays queued writes in order. Stops at the first failure so the outbox
 * keeps its ordering guarantee, and returns how many ops were delivered.
 */
export async function flushOutbox(): Promise<number> {
  const queue = readOutbox();
  let delivered = 0;

  for (const op of queue) {
    try {
      if (op.kind === "create") {
        const result = await deliverCreate(op.id, op.tempId, op.projectId, op.payload);
        if (result.error || result.offline) break;
        delivered += 1;
      } else if (op.kind === "update") {
        if (op.commentId.startsWith("local-")) {
          removeOp(op.id);
          continue;
        }
        const response = await fetch(`${API.comments}?id=${encodeURIComponent(op.commentId)}`, {
          method: "PATCH",
          headers: writeHeaders(),
          body: JSON.stringify({ body: op.body, author: op.author }),
        });
        if (!response.ok) break;
        removeOp(op.id);
        delivered += 1;
      } else {
        if (op.commentId.startsWith("local-")) {
          clearLocalComment(op.projectId, op.commentId);
          removeOp(op.id);
          continue;
        }
        const response = await fetch(
          `${API.comments}?id=${encodeURIComponent(op.commentId)}&author=${encodeURIComponent(op.author)}`,
          { method: "DELETE", headers: writeHeaders() },
        );
        if (!response.ok) break;
        removeOp(op.id);
        delivered += 1;
      }
    } catch {
      break;
    }
  }

  return delivered;
}

export function pendingWriteCount(): number {
  return readOutbox().length;
}

// --- Uploads ----------------------------------------------------------------

/**
 * Uploads one prepared draft. Sends the raw bytes so the server can validate
 * the real content type (magic bytes) rather than trusting a filename.
 */
export async function uploadImage(
  draft: { blob: Blob; name: string; uid: string },
  meta: { projectId: string; width: number; height: number },
): Promise<{ url: string | null; error?: string; base64?: boolean }> {
  try {
    const response = await fetch(API.upload, {
      method: "POST",
      headers: {
        ...writeHeaders(),
        "content-type": draft.blob.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(draft.name),
        "x-project-id": encodeURIComponent(meta.projectId),
        "x-content-length": String(draft.blob.size),
      },
      body: draft.blob,
    });

    const payload = await parse<{ url: string; base64?: boolean }>(response);

    if (response.ok && payload.data?.url) {
      setOffline(false);
      return { url: payload.data.url, base64: payload.data.base64 };
    }

    // Last-resort inline path, exactly as specced: base64 for small files only.
    if (payload.code === "DB_NOT_CONFIGURED" || response.status === 503) {
      setOffline(true);
      if (draft.blob.size <= IMAGE_LIMITS.base64FallbackMaxBytes) {
        console.warn(
          `[partner-dashboard] No storage backend configured. Inlining "${draft.name}" (${draft.blob.size} B) as base64 — this only works under ${IMAGE_LIMITS.base64FallbackMaxBytes} B.`,
        );
        const url = await blobToDataUrl(draft.blob);
        return { url, base64: true };
      }
      return {
        url: null,
        error: `Storage is not configured and this image is larger than ${Math.round(IMAGE_LIMITS.base64FallbackMaxBytes / 1024)} KB.`,
      };
    }

    return { url: null, error: payload.error || "Upload failed." };
  } catch (error) {
    setOffline(true);
    if (draft.blob.size <= IMAGE_LIMITS.base64FallbackMaxBytes) {
      const url = await blobToDataUrl(draft.blob);
      return { url, base64: true };
    }
    return { url: null, error: (error as Error).message };
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image"));
    reader.readAsDataURL(blob);
  });
}

export { STORAGE_BUCKET };
