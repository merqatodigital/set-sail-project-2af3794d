import { statusStyle } from "@/lib/partnerDashboard/status";

/**
 * Status pill. Colour is never the only signal — a solid dot plus the text
 * label means the four states stay distinguishable in greyscale and to
 * colour-blind readers.
 */
export function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const style = statusStyle(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${style.chip} ${
        compact ? "text-[11px]" : "text-xs"
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {status}
    </span>
  );
}
