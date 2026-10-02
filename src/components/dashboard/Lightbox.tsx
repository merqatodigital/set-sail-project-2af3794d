import { useCallback, useEffect, useRef } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export interface LightboxImage {
  url: string;
  alt: string;
  /** Optional caption shown under the image. */
  caption?: string;
}

interface LightboxProps {
  images: LightboxImage[];
  /** Index of the image to show, or null when the lightbox is closed. */
  index: number | null;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Modal image viewer.
 *
 * Accessibility, per the brief:
 *   • Esc closes
 *   • focus is trapped inside while open (Tab and Shift+Tab both cycle)
 *   • focus returns to the element that opened it on close
 *   • the dialog is labelled and marked modal for assistive tech
 */
export function Lightbox({ images, index, onClose, onIndexChange }: LightboxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const isOpen = index !== null && images.length > 0;

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      const next = (index + delta + images.length) % images.length;
      onIndexChange(next);
    },
    [index, images.length, onIndexChange],
  );

  // Remember what had focus, then move focus into the dialog.
  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const first = containerRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? containerRef.current)?.focus();
    return () => previouslyFocused.current?.focus();
  }, [isOpen]);

  // Keyboard handling: Esc, arrows, and the focus trap.
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
        return;
      }
      if (event.key !== "Tab") return;

      const nodes = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((node) => node.offsetParent !== null);
      if (!nodes.length) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // Prevent the page behind the modal from scrolling.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose, go]);

  if (!isOpen) return null;

  const current = images[index as number];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={current.alt || "Image preview"}
      onClick={(event) => {
        // Only a click on the backdrop itself closes the viewer.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={containerRef} className="relative flex max-h-full w-full max-w-5xl flex-col items-center">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close image preview"
          className="absolute -top-12 right-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <X className="h-5 w-5" />
        </button>

        {images.length > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous image"
            className="absolute left-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:-left-14"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        <img
          src={current.url}
          alt={current.alt}
          className="max-h-[75vh] w-auto max-w-full rounded-lg object-contain shadow-2xl"
        />

        {images.length > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next image"
            className="absolute right-0 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:-right-14"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}

        <div className="mt-3 text-center">
          {current.caption && <p className="text-sm text-white/80">{current.caption}</p>}
          {images.length > 1 && (
            <p className="mt-1 text-xs text-white/50">
              {(index as number) + 1} of {images.length}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
