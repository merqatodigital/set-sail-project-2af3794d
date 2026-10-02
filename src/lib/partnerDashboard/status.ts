// =============================================================================
// Partner Dashboard — status badge presentation
// =============================================================================
// Four canonical statuses, each with a distinct colour as specified:
//   Live        → green
//   In Progress → amber
//   Planned     → blue
//   Blocked     → red
//
// Colours are tuned to sit beside the site's existing warm palette (cream
// #FAF6EF, ink #26221C, gold #C6A15B) rather than the saturated default
// Tailwind swatches, so the dashboard reads as part of Marina Terrace.
// =============================================================================

import type { ProjectStatus } from "./types";

export interface StatusStyle {
  /** Chip classes: background, text, border. */
  chip: string;
  /** Solid dot colour, used as a secondary (non-colour-only) cue. */
  dot: string;
}

const STATUS_STYLES: Record<ProjectStatus, StatusStyle> = {
  Live: {
    chip: "bg-[#E8F3EA] text-[#1F5B33] border-[#BFDCC6]",
    dot: "bg-[#2E7D4F]",
  },
  "In Progress": {
    chip: "bg-[#FBF1DF] text-[#7A5410] border-[#E8D2A8]",
    dot: "bg-[#C08A2E]",
  },
  Planned: {
    chip: "bg-[#E7EEF7] text-[#23486F] border-[#C3D5E9]",
    dot: "bg-[#37699B]",
  },
  Blocked: {
    chip: "bg-[#F9E9E7] text-[#7C2D22] border-[#E8C4BF]",
    dot: "bg-[#B4402F]",
  },
};

/**
 * Unknown values never throw. The DB deliberately has no CHECK constraint on
 * `status` (so a new status needs no migration), which means a typo or a
 * future value must degrade to a neutral badge instead of a blank cell.
 */
const FALLBACK: StatusStyle = {
  chip: "bg-[#EFEAE1] text-[#5A5248] border-[#DCD3C4]",
  dot: "bg-[#8A8071]",
};

export const CANONICAL_STATUSES: ProjectStatus[] = [
  "Live",
  "In Progress",
  "Planned",
  "Blocked",
];

export function isCanonicalStatus(value: string): value is ProjectStatus {
  return (CANONICAL_STATUSES as string[]).includes(value);
}

export function statusStyle(status: string): StatusStyle {
  return isCanonicalStatus(status) ? STATUS_STYLES[status] : FALLBACK;
}
