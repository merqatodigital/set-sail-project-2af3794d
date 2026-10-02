import { useEffect, useRef, useState } from "react";
import { Smile } from "lucide-react";

// A dependency-free emoji picker. A full emoji library would blow the 40 KB
// budget on its own, so this ships a curated set that covers how people
// actually talk in a project thread.
const EMOJI: Array<{ group: string; items: string[] }> = [
  {
    group: "Reactions",
    items: ["👍", "👎", "🙌", "👏", "🔥", "✅", "❌", "⚠️", "💡", "🎉", "❤️", "🙏", "😅", "😂", "🤔", "👀"],
  },
  {
    group: "Work",
    items: ["📄", "🎨", "📝", "📌", "📊", "💰", "🔗", "📷", "🎬", "🛠️", "🚀", "⏳", "📅", "📍", "🧾", "🔒"],
  },
  {
    group: "Nature & travel",
    items: ["🌴", "🌊", "🏝️", "☀️", "🌙", "🐢", "🐠", "🍹", "☕", "🍽️", "🛏️", "🏄", "✈️", "🗺️", "📶", "⚡"],
  },
];

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  /** Aligns the popover; defaults to the left edge of the trigger. */
  align?: "left" | "right";
}

/**
 * Small popover picker. Closes on outside click and on Esc, and is a real
 * menu button so it is reachable and dismissible by keyboard.
 */
export function EmojiPicker({ onPick, align = "left" }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Insert emoji"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E2D9C8] bg-white text-[#6B6255] transition hover:border-[#C6A15B] hover:text-[#C6A15B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6A15B]"
      >
        <Smile className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Emoji"
          className={`absolute bottom-full z-30 mb-2 w-64 rounded-xl border border-[#E2D9C8] bg-white p-3 shadow-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {EMOJI.map((section) => (
            <div key={section.group} className="mb-2 last:mb-0">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[#8A8071]">
                {section.group}
              </p>
              <div className="flex flex-wrap gap-0.5">
                {section.items.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onPick(emoji);
                      setOpen(false);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg transition hover:bg-[#F3ECDD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#C6A15B]"
                  >
                    <span aria-hidden="true">{emoji}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
