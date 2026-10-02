import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pencil, Reply, RotateCcw, Trash2 } from "lucide-react";

import {
  deleteComment,
  fetchComments,
  flushOutbox,
  pendingWriteCount,
  retryComment,
  updateComment,
} from "@/lib/partnerDashboard/api";
import { detectLink, linkifySegments } from "@/lib/partnerDashboard/attach";
import { readLocalComments } from "@/lib/partnerDashboard/local";
import { sanitizeCommentText } from "@/lib/partnerDashboard/sanitize";
import { IMAGE_LIMITS } from "@/lib/partnerDashboard/config";
import { formatDateTime } from "./format";
import type { CommentNode } from "@/lib/partnerDashboard/types";
import type { LightboxImage } from "./Lightbox";
import { CommentComposer } from "./CommentComposer";

interface ThreadProps {
  projectId: string;
  author: string;
  onOpenImage: (images: LightboxImage[], index: number) => void;
  onCountChange?: (count: number) => void;
  /** Rendered above the list; used to show which backend is live. */
  backendLabel?: string;
}

export function Thread({ projectId, author, onOpenImage, onCountChange, backendLabel }: ThreadProps) {
  const [nodes, setNodes] = useState<CommentNode[]>(() => readLocalComments(projectId));
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);

  const highlightTimer = useRef<number | null>(null);

  // Roll the reply + edit state (not the data) back to a clean slate.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const count = useMemo(
    () => nodes.reduce((total, node) => total + (node.deleted_at ? 0 : 1) + (node.replies ?? []).filter((r) => !r.deleted_at).length, 0),
    [nodes],
  );

  useEffect(() => {
    onCountChange?.(count);
  }, [count, onCountChange]);

  const load = useCallback(
    async (showSkeleton: boolean) => {
      if (showSkeleton) setLoading(true);
      const result = await fetchComments(projectId);
      if (result.data) setNodes(result.data);
      setLoading(false);
      setQueued(pendingWriteCount());

      // The server is reachable again — replay anything still queued.
      if (!result.offline && pendingWriteCount() > 0) {
        const delivered = await flushOutbox();
        if (delivered > 0) {
          const refreshed = readLocalComments(projectId);
          setNodes(refreshed);
          setQueued(pendingWriteCount());
        }
      }
    },
    [projectId],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  // Poll while the thread is open so the other person's replies show up
  // without a manual refresh. Paused when the tab is hidden.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(
    () => () => {
      if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    },
    [],
  );

  const flashHighlight = useCallback((id: string | null) => {
    setHighlightId(id);
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    if (!id) return;
    const element = document.getElementById(`comment-${id}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 2600);
  }, []);

  const handleSubmitted = useCallback(
    (node: CommentNode | null) => {
      setReplyingTo(null);
      const refreshed = readLocalComments(projectId);
      setNodes(refreshed);
      setQueued(pendingWriteCount());

      // Prefer the id the server assigned; otherwise highlight the newest
      // local node (the optimistic one that has not synced yet).
      const fallback = [...refreshed]
        .flatMap((item) => [item, ...(item.replies ?? [])])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      flashHighlight(node?.id ?? fallback?.id ?? null);
    },
    [projectId, flashHighlight],
  );

  const saveEdit = async (comment: CommentNode) => {
    const text = sanitizeCommentText(editDraft, IMAGE_LIMITS.maxCommentChars);
    if (!text) return;
    setEditingId(null);
    setNodes((current) =>
      current.map((node) =>
        node.id === comment.id
          ? { ...node, body: text }
          : { ...node, replies: (node.replies ?? []).map((r) => (r.id === comment.id ? { ...r, body: text } : r)) },
      ),
    );
    const result = await updateComment(projectId, comment.id, text, author);
    if (result.error && !result.offline) {
      setNodes(readLocalComments(projectId));
    }
    void load(false);
  };

  const confirmDelete = async (comment: CommentNode) => {
    setConfirmDeleteId(null);
    setNodes((current) =>
      current.map((node) =>
        node.id === comment.id
          ? { ...node, deleted_at: new Date().toISOString(), body: "" }
          : {
              ...node,
              replies: (node.replies ?? []).map((r) =>
                r.id === comment.id ? { ...r, deleted_at: new Date().toISOString(), body: "" } : r,
              ),
            },
      ),
    );
    const result = await deleteComment(projectId, comment.id, author);
    if (result.error && !result.offline) {
      setNodes(readLocalComments(projectId));
    }
    void load(false);
  };

  const retry = async (comment: CommentNode) => {
    await retryComment(projectId, comment.id);
    setNodes(readLocalComments(projectId));
    void load(false);
  };

  // --- Loading skeletons (never a spinner) ---------------------------------
  if (loading && nodes.length === 0) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading comments…</span>
        {[0, 1].map((index) => (
          <div key={index} className="rounded-xl border border-[#EFE7D8] bg-white p-4">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 animate-pulse rounded-full bg-[#EFE7D8]" />
              <div className="h-3 w-28 animate-pulse rounded bg-[#EFE7D8]" />
            </div>
            <div className="mt-3 space-y-2">
              <div className="h-3 w-full animate-pulse rounded bg-[#F3ECDD]" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-[#F3ECDD]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[#6B6255]">
          <span className="font-medium text-[#26221C]">Thread</span>
          {" · "}
          {count === 1 ? "1 comment" : `${count} comments`}
          {backendLabel && <span className="text-[#9A9081]"> · {backendLabel}</span>}
        </p>
        {queued > 0 && (
          <p className="text-[11px] text-[#7A5410]">
            {queued} write{queued === 1 ? "" : "s"} waiting to sync
          </p>
        )}
      </div>

      {nodes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#E2D9C8] bg-[#FDFBF7] px-4 py-6 text-center text-sm text-[#8A8071]">
          No comments yet — start the thread.
        </p>
      ) : (
        <ul className="space-y-3">
          {nodes.map((node) => (
            <li key={node.id}>
              <CommentItem
                comment={node}
                author={author}
                highlightId={highlightId}
                editingId={editingId}
                editDraft={editDraft}
                confirmDeleteId={confirmDeleteId}
                onOpenImage={onOpenImage}
                onStartEdit={(comment) => {
                  setEditingId(comment.id);
                  setEditDraft(comment.body);
                }}
                onEditDraftChange={setEditDraft}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={saveEdit}
                onAskDelete={setConfirmDeleteId}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onConfirmDelete={confirmDelete}
                onRetry={retry}
                onReply={setReplyingTo}
              />

              {/* Replies: exactly one level deep */}
              {(node.replies ?? []).length > 0 && (
                <ul className="mt-2 space-y-2 border-l-2 border-[#EFE7D8] pl-3 sm:pl-4">
                  {(node.replies ?? []).map((reply) => (
                    <li key={reply.id}>
                      <CommentItem
                        comment={reply}
                        author={author}
                        isReply
                        highlightId={highlightId}
                        editingId={editingId}
                        editDraft={editDraft}
                        confirmDeleteId={confirmDeleteId}
                        onOpenImage={onOpenImage}
                        onStartEdit={(comment) => {
                          setEditingId(comment.id);
                          setEditDraft(comment.body);
                        }}
                        onEditDraftChange={setEditDraft}
                        onCancelEdit={() => setEditingId(null)}
                        onSaveEdit={saveEdit}
                        onAskDelete={setConfirmDeleteId}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                        onConfirmDelete={confirmDelete}
                        onRetry={retry}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {replyingTo === node.id && (
                <div className="mt-2 border-l-2 border-[#EFE7D8] pl-3 sm:pl-4">
                  <CommentComposer
                    projectId={projectId}
                    author={author}
                    parentId={node.id}
                    parentAuthor={node.author}
                    onSubmitted={handleSubmitted}
                    onCancel={() => setReplyingTo(null)}
                    compact
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <CommentComposer projectId={projectId} author={author} onSubmitted={handleSubmitted} />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface CommentItemProps {
  comment: CommentNode;
  author: string;
  isReply?: boolean;
  highlightId: string | null;
  editingId: string | null;
  editDraft: string;
  confirmDeleteId: string | null;
  onOpenImage: (images: LightboxImage[], index: number) => void;
  onStartEdit: (comment: CommentNode) => void;
  onEditDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (comment: CommentNode) => void;
  onAskDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (comment: CommentNode) => void;
  onRetry: (comment: CommentNode) => void;
  /** Absent on replies, which cannot be replied to (one level only). */
  onReply?: (id: string) => void;
}

function CommentItem({
  comment,
  author,
  isReply = false,
  highlightId,
  editingId,
  editDraft,
  confirmDeleteId,
  onOpenImage,
  onStartEdit,
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
  onRetry,
  onReply,
}: CommentItemProps) {
  const isAuthor = comment.author === author;
  const deleted = Boolean(comment.deleted_at);
  const edited = !deleted && comment.updated_at !== comment.created_at;

  const imageAttachments = comment.attachments.filter(
    (attachment) => attachment.kind === "image",
  );
  const linkAttachments = comment.attachments.filter((attachment) => attachment.kind === "link");

  const openImage = (index: number) => {
    onOpenImage(
      imageAttachments.map((attachment) => ({
        url: attachment.url,
        alt: attachment.label || `Image attached by ${comment.author}`,
        caption: `${comment.author} · ${formatDateTime(comment.created_at)}`,
      })),
      index,
    );
  };

  return (
    <article
      id={`comment-${comment.id}`}
      className={`rounded-xl border p-3 transition-colors duration-500 sm:p-4 ${
        highlightId === comment.id
          ? "border-[#C6A15B] bg-[#FBF6EA]"
          : "border-[#EFE7D8] bg-white"
      } ${comment.pending ? "opacity-70" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#1F3D2B] text-[11px] font-semibold text-white">
          {comment.author.slice(0, 1).toUpperCase()}
        </span>
        <span className="text-sm font-medium text-[#26221C]">{comment.author}</span>
        <time dateTime={comment.created_at} className="text-[11px] text-[#8A8071]">
          {formatDateTime(comment.created_at)}
        </time>
        {edited && <span className="text-[11px] text-[#8A8071]">· edited</span>}
        {comment.pending && (
          <span className="inline-flex items-center gap-1 text-[11px] text-[#7A5410]">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            sending…
          </span>
        )}
        {comment.failed && (
          <span className="inline-flex items-center gap-1 text-[11px] text-[#7C2D22]">
            not sent
            <button
              type="button"
              onClick={() => onRetry(comment)}
              className="inline-flex items-center gap-0.5 rounded-full border border-[#E8C4BF] px-1.5 py-0.5 font-medium transition hover:bg-[#F9E9E7]"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Retry
            </button>
          </span>
        )}
      </header>

      {deleted ? (
        <p className="mt-2 text-sm italic text-[#8A8071]">This comment was deleted.</p>
      ) : editingId === comment.id ? (
        <div className="mt-2">
          <label className="sr-only" htmlFor={`edit-${comment.id}`}>
            Edit comment
          </label>
          <textarea
            id={`edit-${comment.id}`}
            value={editDraft}
            onChange={(event) => onEditDraftChange(event.target.value)}
            rows={3}
            maxLength={IMAGE_LIMITS.maxCommentChars}
            className="w-full resize-y rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] px-3 py-2 text-sm outline-none focus:border-[#C6A15B] focus:ring-2 focus:ring-[#C6A15B]/25"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onSaveEdit(comment)}
              className="rounded-full bg-[#C6A15B] px-3 py-1 text-xs font-semibold text-[#221D14] transition hover:bg-[#D9BA80]"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-full px-3 py-1 text-xs font-medium text-[#6B6255] transition hover:bg-[#F3ECDD]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {comment.body && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#26221C]">
              {linkifySegments(comment.body).map((segment, index) =>
                segment.type === "url" ? (
                  <a
                    key={index}
                    href={segment.value}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#8A6B32] underline decoration-[#C6A15B]/40 underline-offset-2 transition hover:decoration-[#C6A15B]"
                  >
                    {segment.value}
                  </a>
                ) : (
                  <span key={index}>{segment.value}</span>
                ),
              )}
            </p>
          )}

          {imageAttachments.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {imageAttachments.map((attachment, index) => (
                <li key={attachment.id}>
                  <button
                    type="button"
                    onClick={() => openImage(index)}
                    className="block h-20 w-20 overflow-hidden rounded-lg border border-[#EFE7D8] transition hover:border-[#C6A15B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6A15B] sm:h-24 sm:w-24"
                    aria-label={`Open image: ${attachment.label || "attachment"}`}
                  >
                    <img
                      src={attachment.url}
                      alt={attachment.label || `Image attached by ${comment.author}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {linkAttachments.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {linkAttachments.map((attachment) => {
                const chip = detectLink(attachment.url);
                let host = attachment.url;
                try {
                  host = new URL(attachment.url).hostname.replace(/^www\./, "");
                } catch {
                  /* keep the raw value */
                }
                return (
                  <li key={attachment.id}>
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={attachment.url}
                      className="inline-flex max-w-[15rem] items-center gap-1.5 rounded-full border border-[#E2D9C8] bg-[#F7F2E8] px-2.5 py-1 text-[11px] text-[#5A5248] transition hover:border-[#C6A15B] hover:text-[#8A6B32]"
                    >
                      <span aria-hidden="true">{chip.icon}</span>
                      <span className="font-medium">{attachment.label || chip.label}</span>
                      <span className="truncate text-[#9A9081]">{host}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {!deleted && editingId !== comment.id && (
        <footer className="mt-2 flex items-center gap-3">
          {!isReply && onReply && (
            <button
              type="button"
              onClick={() => onReply(comment.id)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6B6255] transition hover:text-[#8A6B32]"
            >
              <Reply className="h-3 w-3" aria-hidden="true" />
              Reply
            </button>
          )}

          {isAuthor && !comment.pending && !comment.failed && (
            <>
              <button
                type="button"
                onClick={() => onStartEdit(comment)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6B6255] transition hover:text-[#8A6B32]"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                Edit
              </button>

              {confirmDeleteId === comment.id ? (
                <span className="inline-flex items-center gap-2 text-[11px]">
                  <span className="text-[#7C2D22]">Delete this comment?</span>
                  <button
                    type="button"
                    onClick={() => onConfirmDelete(comment)}
                    className="rounded-full bg-[#7C2D22] px-2 py-0.5 font-semibold text-white transition hover:bg-[#8f3527]"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={onCancelDelete}
                    className="rounded-full px-2 py-0.5 font-medium text-[#6B6255] transition hover:bg-[#F3ECDD]"
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onAskDelete(comment.id)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6B6255] transition hover:text-[#7C2D22]"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  Delete
                </button>
              )}
            </>
          )}
        </footer>
      )}
    </article>
  );
}
