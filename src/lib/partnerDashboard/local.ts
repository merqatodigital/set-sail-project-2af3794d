// =============================================================================
// Partner Dashboard — offline store + write outbox
// =============================================================================
// Guarantees the brief's requirement: "If the backend is unreachable, the UI
// falls back to localStorage so nothing breaks — and shows a small 'offline —
// changes saved locally' banner."
//
// Two ideas live here:
//   1. A local mirror of each project's thread, including optimistic rows that
//      the server has not acknowledged yet (pending / failed).
//   2. An outbox — an ordered queue of writes that still need to reach the
//      server. It is replayed automatically the next time a read succeeds.
// =============================================================================

import { LS_KEYS } from "./config";
import type { Attachment, CommentNode, CreateCommentInput } from "./types";

// --- Outbox -----------------------------------------------------------------

export type OutboxOp =
  | { id: string; kind: "create"; tempId: string; projectId: string; payload: CreateCommentInput }
  | { id: string; kind: "update"; commentId: string; projectId: string; body: string; author: string }
  | { id: string; kind: "delete"; commentId: string; projectId: string; author: string };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — best effort */
  }
}

export function readOutbox(): OutboxOp[] {
  return readJson<OutboxOp[]>(LS_KEYS.outbox, []);
}

export function queueOp(op: OutboxOp): void {
  const queue = readOutbox();
  queue.push(op);
  writeJson(LS_KEYS.outbox, queue);
}

export function removeOp(opId: string): void {
  writeJson(
    LS_KEYS.outbox,
    readOutbox().filter((op) => op.id !== opId),
  );
}

export function updateOp(opId: string, patch: Partial<OutboxOp>): void {
  const queue = readOutbox().map((op) => (op.id === opId ? ({ ...op, ...patch } as OutboxOp) : op));
  writeJson(LS_KEYS.outbox, queue);
}

export function clearOutbox(): void {
  writeJson(LS_KEYS.outbox, []);
}

// --- Thread mirror ----------------------------------------------------------

type ThreadMap = Record<string, CommentNode[]>;

function readThreads(): ThreadMap {
  return readJson<ThreadMap>(LS_KEYS.comments, {});
}

function writeThreads(map: ThreadMap): void {
  writeJson(LS_KEYS.comments, map);
}

export function readLocalComments(projectId: string): CommentNode[] {
  return readThreads()[projectId] ?? [];
}

export function writeLocalComments(projectId: string, nodes: CommentNode[]): void {
  const map = readThreads();
  map[projectId] = nodes;
  writeThreads(map);
}

/** Walks both levels of the thread (comment → reply) and maps one node. */
function mapNode(
  nodes: CommentNode[],
  predicate: (node: CommentNode) => boolean,
  transform: (node: CommentNode) => CommentNode,
): CommentNode[] {
  return nodes.map((node) => {
    const next = predicate(node) ? transform(node) : node;
    return next.replies?.length
      ? { ...next, replies: next.replies.map((r) => (predicate(r) ? transform(r) : r)) }
      : next;
  });
}

export function newLocalId(prefix = "local"): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

/**
 * Inserts an optimistic comment (or reply) and tags it pending so the UI can
 * style it as "sending…".
 */
export function addLocalComment(
  projectId: string,
  input: CreateCommentInput,
  tempId: string,
): CommentNode {
  const now = new Date().toISOString();
  const node: CommentNode = {
    id: tempId,
    project_id: projectId,
    parent_id: input.parent_id ?? null,
    author: input.author,
    body: input.body,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    attachments: (input.attachments ?? []).map((a, index) => ({
      id: `${tempId}-att-${index}`,
      kind: a.kind,
      url: a.url,
      label: a.label ?? null,
      created_at: now,
    })) as Attachment[],
    replies: [],
    pending: true,
  };

  const current = readLocalComments(projectId);
  const next = input.parent_id
    ? current.map((c) =>
        c.id === input.parent_id ? { ...c, replies: [...(c.replies ?? []), node] } : c,
      )
    : [...current, node];

  writeLocalComments(projectId, next);
  return node;
}

/** Swaps a temporary id for the real one the server assigned. */
export function promoteLocalId(projectId: string, tempId: string, realId: string): void {
  const next = mapNode(
    readLocalComments(projectId),
    (node) => node.id === tempId,
    (node) => ({
      ...node,
      id: realId,
      pending: false,
      failed: false,
      attachments: node.attachments.map((a) => ({
        ...a,
        id: a.id.startsWith(tempId) ? a.id.replace(tempId, realId) : a.id,
      })),
    }),
  );
  writeLocalComments(projectId, next);
}

export function clearLocalComment(projectId: string, tempId: string): void {
  const strip = (nodes: CommentNode[]): CommentNode[] =>
    nodes
      .filter((node) => node.id !== tempId)
      .map((node) => ({ ...node, replies: strip(node.replies ?? []) }));
  writeLocalComments(projectId, strip(readLocalComments(projectId)));
}

export function markLocalFailed(projectId: string, tempId: string, failed = true): void {
  const next = mapNode(
    readLocalComments(projectId),
    (node) => node.id === tempId,
    (node) => ({ ...node, failed, pending: false }),
  );
  writeLocalComments(projectId, next);
}

export function markLocalPending(projectId: string, tempId: string): void {
  const next = mapNode(
    readLocalComments(projectId),
    (node) => node.id === tempId,
    (node) => ({ ...node, failed: false, pending: true }),
  );
  writeLocalComments(projectId, next);
}

export function updateLocalComment(projectId: string, commentId: string, body: string): void {
  const next = mapNode(
    readLocalComments(projectId),
    (node) => node.id === commentId,
    (node) => ({ ...node, body, updated_at: new Date().toISOString() }),
  );
  writeLocalComments(projectId, next);
}

export function softDeleteLocalComment(projectId: string, commentId: string): void {
  const next = mapNode(
    readLocalComments(projectId),
    (node) => node.id === commentId,
    (node) => ({ ...node, deleted_at: new Date().toISOString() }),
  );
  writeLocalComments(projectId, next);
}

/**
 * Reconciles a server response with rows still sitting in the outbox.
 * Optimistic comments are always local-<uuid>, so anything without that
 * prefix is considered authoritative and replaced by the server's copy.
 */
export function mergeServerWithPending(
  serverNodes: CommentNode[],
  localNodes: CommentNode[],
): CommentNode[] {
  const isPending = (node: CommentNode) => node.id.startsWith("local-");

  const mergeReplies = (serverReplies: CommentNode[], localReplies: CommentNode[]) => {
    const extra = localReplies.filter(
      (local) => isPending(local) && !serverReplies.some((s) => s.id === local.id),
    );
    return [...serverReplies, ...extra];
  };

  const merged = serverNodes.map((node) => {
    const local = localNodes.find((l) => l.id === node.id);
    return local
      ? { ...node, replies: mergeReplies(node.replies ?? [], local.replies ?? []) }
      : { ...node, replies: node.replies ?? [] };
  });

  // Optimistic top-level comments the server has not seen yet.
  const pendingTopLevel = localNodes
    .filter((local) => isPending(local) && !serverNodes.some((s) => s.id === local.id))
    .map((node) => ({ ...node, replies: node.replies ?? [] }));

  return [...merged, ...pendingTopLevel];
}

/** Counts live comments (replies included) for the reply badge. */
export function countComments(nodes: CommentNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.deleted_at ? 0 : 1) + countComments(node.replies ?? []),
    0,
  );
}
