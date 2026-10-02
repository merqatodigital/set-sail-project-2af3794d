// =============================================================================
// Partner Dashboard — date formatting
// =============================================================================
// "en-US" is pinned rather than using the visitor's locale: the brief specifies
// an exact format ("Feb 14, 2026 · 3:42 PM"), and a fixed locale keeps the
// string stable between renders.
//
// The date and time are formatted separately and joined with an explicit
// separator, because Intl's combined output uses a comma ("Feb 14, 2026, 3:42
// PM") rather than the middot the brief asks for.
// =============================================================================

import { DATE_FORMAT } from "@/lib/partnerDashboard/config";

const dateFormatter = new Intl.DateTimeFormat("en-US", DATE_FORMAT.date);
const timeFormatter = new Intl.DateTimeFormat("en-US", DATE_FORMAT.time);

function parse(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Feb 14, 2026 · 3:42 PM" — table cells, cards and comment timestamps. */
export function formatDateTime(iso: string): string {
  const date = parse(iso);
  if (!date) return "—";
  return `${dateFormatter.format(date)} · ${timeFormatter.format(date)}`;
}

/** "Feb 14, 2026 at 3:42 PM" — the wording the brief uses for the hero line. */
export function formatUpdatedLine(iso: string): string {
  const date = parse(iso);
  if (!date) return "—";
  return `${dateFormatter.format(date)} at ${timeFormatter.format(date)}`;
}

/** Machine-readable ISO for <time dateTime>. */
export function toIsoMachine(iso: string): string {
  const date = parse(iso);
  return date ? date.toISOString() : "";
}
