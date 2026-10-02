import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Link2, Loader2, Plus, RotateCcw, Send, Trash2, X } from "lucide-react";

import { IMAGE_LIMITS } from "@/lib/partnerDashboard/config";
import { createComment, uploadImage } from "@/lib/partnerDashboard/api";
import { detectLink, extractUrls } from "@/lib/partnerDashboard/attach";
import { sanitizeCommentText } from "@/lib/partnerDashboard/sanitize";
import { formatBytes, prepareImages, revokeDraft, type ImageDraft, type RejectedFile } from "@/lib/partnerDashboard/compress";
import type { CommentNode } from "@/lib/partnerDashboard/types";
import { EmojiPicker } from "./EmojiPicker";

interface CommentComposerProps {
  projectId: string;
  author: string;
  parentId?: string | null;
  parentAuthor?: string;
  onSubmitted: (node: CommentNode | null) => void;
  onCancel?: () => void;
  compact?: boolean;
}

export function CommentComposer({
  projectId,
  author,
  parentId = null,
  parentAuthor,
  onSubmitted,
  onCancel,
  compact = false,
}: CommentComposerProps) {
  const [body, setBody] = useState("");
  const [linkFields, setLinkFields] = useState<string[]>([""]);
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Kept in a ref so the unmount cleanup always sees the latest drafts.
  const imagesRef = useRef<ImageDraft[]>([]);
  imagesRef.current = images;

  const busyUploading = images.some((image) => image.status === "uploading" || image.status === "ready");
  const failedUploads = images.filter((image) => image.status === "failed");
  const uploadedImages = images.filter((image) => image.status === "uploaded" && image.url);

  // --- Derived: URLs typed into the body, shown as live chips ---------------
  const inlineUrls = useMemo(() => extractUrls(body), [body]);
  const validLinks = useMemo(
    () => linkFields.map((value) => value.trim()).filter((value) => value && detectLink(value).icon),
    [linkFields],
  );

  useEffect(() => {
    // Revoke every object URL when the composer goes away.
    return () => imagesRef.current.forEach(revokeDraft);
  }, []);

  // --- Image handling -------------------------------------------------------

  /**
   * Uploads one draft, flipping its status so the thumbnail can show
   * progress, a failure, and a retry button without any extra wiring.
   */
  async function uploadDraft(draft: ImageDraft) {
    setImages((current) =>
      current.map((item) =>
        item.uid === draft.uid ? { ...item, status: "uploading", error: undefined } : item,
      ),
    );
    const result = await uploadImage(draft, {
      projectId,
      width: draft.width,
      height: draft.height,
    });
    setImages((current) =>
      current.map((item) =>
        item.uid === draft.uid
          ? result.url
            ? { ...item, status: "uploaded", url: result.url, error: undefined }
            : { ...item, status: "failed", error: result.error ?? "Upload failed" }
          : item,
      ),
    );
  }

  async function addFiles(files: Array<File | Blob>) {
    if (!files.length) return;
    setError(null);
    const { accepted, rejected: refused } = await prepareImages(files, imagesRef.current.length);
    setRejected(refused);
    if (!accepted.length) return;
    setImages((current) => [...current, ...accepted]);

    // Upload immediately so submission is fast and failures surface early.
    accepted.forEach((draft) => void uploadDraft(draft));
  }

  const removeImage = (uid: string) => {
    setImages((current) => {
      const target = current.find((item) => item.uid === uid);
      if (target) revokeDraft(target);
      return current.filter((item) => item.uid !== uid);
    });
  };

  // --- Paste: screenshots become attachments, URLs become chips -------------
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length) {
      event.preventDefault();
      void addFiles(files);
    }
    // Pasted text is left alone — extractUrls() above turns any URL into a
    // chip automatically as the body updates.
  };

  // --- Submit ---------------------------------------------------------------

  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setBody((current) => current + text);
      return;
    }
    const start = textarea.selectionStart ?? body.length;
    const end = textarea.selectionEnd ?? body.length;
    const next = body.slice(0, start) + text + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + text.length;
      textarea.setSelectionRange(caret, caret);
    });
  };

  const canSubmit =
    !submitting &&
    !busyUploading &&
    (body.trim().length > 0 || uploadedImages.length > 0 || validLinks.length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const text = sanitizeCommentText(body, IMAGE_LIMITS.maxCommentChars);
    const attachments = [
      ...uploadedImages.map((image) => ({
        kind: "image" as const,
        url: image.url as string,
        label: image.name,
      })),
      ...validLinks.map((url) => ({
        kind: "link" as const,
        url,
        label: detectLink(url).label,
      })),
    ];

    const result = await createComment(projectId, {
      parent_id: parentId,
      author,
      body: text,
      attachments,
    });

    setSubmitting(false);

    if (result.error) {
      setError(result.error);
      // The comment is already shown optimistically with a retry affordance,
      // so clear the composer only when the write actually landed.
      if (!result.offline) return;
    }

    images.forEach(revokeDraft);
    setBody("");
    setImages([]);
    setLinkFields([""]);
    setRejected([]);
    onSubmitted((result.data as CommentNode | null) ?? null);
  };

  return (
    <div
      className={`rounded-xl border p-3 transition ${
        dragging
          ? "border-[#C6A15B] bg-[#FBF6EA]"
          : "border-[#E2D9C8] bg-white"
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length) void addFiles(files);
      }}
    >
      {parentAuthor && (
        <p className="mb-2 text-xs text-[#6B6255]">
          Replying to <span className="font-medium text-[#26221C]">{parentAuthor}</span>
        </p>
      )}

      <label className="sr-only" htmlFor={`comment-body-${parentId ?? "root"}`}>
        {parentId ? "Write a reply" : "Write a comment"}
      </label>
      <textarea
        id={`comment-body-${parentId ?? "root"}`}
        ref={textareaRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onPaste={onPaste}
        rows={compact ? 2 : 3}
        maxLength={IMAGE_LIMITS.maxCommentChars}
        placeholder={parentId ? "Write a reply…" : "Write an update or a note… paste any link"}
        className="w-full resize-y rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] px-3 py-2 text-sm text-[#26221C] outline-none transition placeholder:text-[#9A9081] focus:border-[#C6A15B] focus:ring-2 focus:ring-[#C6A15B]/25"
      />

      {/* --- Inline chips for URLs typed into the body ---------------------- */}
      {inlineUrls.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {inlineUrls.map((url) => {
            const chip = detectLink(url);
            return (
              <span
                key={url}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#E2D9C8] bg-[#F7F2E8] px-2 py-0.5 text-[11px] text-[#5A5248]"
                title={url}
              >
                <span aria-hidden="true">{chip.icon}</span>
                <span className="font-medium">{chip.label}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* --- Image previews ------------------------------------------------- */}
      {images.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {images.map((image) => (
            <li key={image.uid} className="relative">
              <div className="group relative h-20 w-20 overflow-hidden rounded-lg border border-[#E2D9C8] bg-[#F3ECDD]">
                <img
                  src={image.previewUrl}
                  alt={image.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                {image.status === "uploading" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
                    <span className="sr-only">Uploading {image.name}</span>
                  </div>
                )}
                {image.status === "failed" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#7C2D22]/85 p-1 text-center">
                    <AlertCircle className="h-4 w-4 text-white" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => void uploadDraft(image)}
                      className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-medium text-[#7C2D22] transition hover:bg-white"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" />
                      Retry
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => removeImage(image.uid)}
                aria-label={`Remove ${image.name}`}
                className="absolute -right-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#26221C] text-white shadow transition hover:bg-[#7C2D22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#C6A15B]"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>

              <p className="mt-1 w-20 truncate text-[10px] text-[#8A8071]" title={`${image.name} · ${formatBytes(image.bytes)}`}>
                {formatBytes(image.bytes)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* --- Extra link fields ---------------------------------------------- */}
      <div className="mt-3 space-y-1.5">
        {linkFields.map((value, index) => {
          const chip = value.trim() ? detectLink(value) : null;
          return (
            <div key={index} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="w-4 text-center text-xs">
                {chip ? chip.icon : "🔗"}
              </span>
              <input
                type="url"
                inputMode="url"
                value={value}
                onChange={(event) =>
                  setLinkFields((current) =>
                    current.map((item, i) => (i === index ? event.target.value : item)),
                  )
                }
                placeholder="https://drive.google.com/…  https://figma.com/…"
                aria-label={index === 0 ? "Link" : `Link ${index + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] px-2.5 py-1.5 text-xs text-[#26221C] outline-none transition placeholder:text-[#9A9081] focus:border-[#C6A15B] focus:ring-2 focus:ring-[#C6A15B]/25"
              />
              {chip && <span className="hidden text-[10px] text-[#8A8071] sm:inline">{chip.label}</span>}
              {linkFields.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLinkFields((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Remove link ${index + 1}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[#8A8071] transition hover:bg-[#F3ECDD] hover:text-[#7C2D22]"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* --- Rejections ------------------------------------------------------ */}
      {(rejected.length > 0 || failedUploads.length > 0) && (
        <ul className="mt-2 space-y-0.5">
          {rejected.map((file) => (
            <li key={`${file.name}-${file.reason}`} className="text-[11px] text-[#7C2D22]">
              {file.name}: {file.reason}
            </li>
          ))}
          {failedUploads.map((image) => (
            <li key={image.uid} className="text-[11px] text-[#7C2D22]">
              {image.name}: {image.error ?? "Upload failed"} — use Retry on the thumbnail.
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[11px] text-[#7C2D22]">
          {error}
        </p>
      )}

      {/* --- Toolbar -------------------------------------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <EmojiPicker onPick={(emoji) => insertAtCursor(emoji)} />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={images.length >= IMAGE_LIMITS.maxImagesPerComment}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#E2D9C8] bg-white px-3 text-xs font-medium text-[#5A5248] transition hover:border-[#C6A15B] hover:text-[#C6A15B] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6A15B]"
        >
          <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
          Images
          <span className="text-[10px] text-[#9A9081]">
            {images.length}/{IMAGE_LIMITS.maxImagesPerComment}
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_LIMITS.acceptedTypes.join(",")}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            if (files.length) void addFiles(files);
            event.target.value = ""; // allow re-selecting the same file
          }}
        />

        <button
          type="button"
          onClick={() => setLinkFields((current) => [...current, ""])}
          disabled={linkFields.length >= IMAGE_LIMITS.maxLinksPerComment}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#E2D9C8] bg-white px-3 text-xs font-medium text-[#5A5248] transition hover:border-[#C6A15B] hover:text-[#C6A15B] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6A15B]"
        >
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Add link
          {linkFields.length > 1 && (
            <span className="text-[10px] text-[#9A9081]">
              {linkFields.length}/{IMAGE_LIMITS.maxLinksPerComment}
            </span>
          )}
        </button>

        <span className="ml-auto flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex h-8 items-center rounded-full px-3 text-xs font-medium text-[#6B6255] transition hover:bg-[#F3ECDD]"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#C6A15B] px-4 text-xs font-semibold tracking-wide text-[#221D14] shadow-[0_3px_10px_rgba(198,161,91,0.35)] transition hover:bg-[#D9BA80] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6A15B]"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : parentId ? (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {busyUploading && !submitting ? "Uploading…" : parentId ? "Reply" : "Post comment"}
          </button>
        </span>
      </div>

      <p className="mt-2 text-[10px] text-[#9A9081]">
        Posting as {author} · up to {IMAGE_LIMITS.maxImagesPerComment} images (
        {Math.round(IMAGE_LIMITS.maxBytesPerImage / 1024 / 1024)} MB each, compressed before upload) · drag
        and drop or paste a screenshot anywhere in the box
      </p>
    </div>
  );
}
