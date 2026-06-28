// Presentation metadata for pipeline stages and warm signals. Pure data — no
// JSX — so it can be imported anywhere. Colours are the Figma pastel block tokens
// (brand-constant across both themes); components render them as solid chip fills
// with ink text via tintStyle. Hexes mirror the --block-* vars in app/globals.css.
import type { ProspectStage, SignalType, EmailStatus } from "@/lib/contract";

// Figma pastel block palette (must match app/globals.css --block-* + --success).
const BLOCK = {
  lime: "#dceeb1",
  lilac: "#c5b0f4",
  cream: "#f4ecd6",
  pink: "#efd4d4",
  mint: "#c8e6cd",
  coral: "#f3c9b6",
  navy: "#1f1d3d",
  success: "#1ea64a",
  neutral: "#e6e6e6", // hairline — off-ramp / unknown
} as const;

export interface StageMeta {
  label: string;
  hex: string;
  blurb: string;
}

// Ordered, left -> right, matches PIPELINE_STAGES in lib/contract.
// `hex` is rendered only as a small solid stage dot.
export const STAGE_META: Record<ProspectStage, StageMeta> = {
  sourced: { label: "Sourced", hex: BLOCK.coral, blurb: "Matched to the ICP" },
  enriched: { label: "Enriched", hex: BLOCK.lilac, blurb: "Firmographics + warm signal" },
  qualified: { label: "Qualified", hex: BLOCK.lime, blurb: "Cleared the fit bar" },
  contacted: { label: "Contacted", hex: BLOCK.cream, blurb: "Email shipped" },
  replied: { label: "Replied", hex: BLOCK.mint, blurb: "They wrote back" },
  booked: { label: "Booked", hex: BLOCK.success, blurb: "Meeting on the calendar" },
  skipped: { label: "Skipped", hex: BLOCK.neutral, blurb: "Off-ramped" },
};

export interface SignalMeta {
  label: string;
  hex: string;
}

export const SIGNAL_META: Record<SignalType, SignalMeta> = {
  funding: { label: "Funding", hex: BLOCK.mint },
  hiring: { label: "Hiring", hex: BLOCK.lime },
  news: { label: "News", hex: BLOCK.lilac },
  post: { label: "Post", hex: BLOCK.pink },
  job_change: { label: "New role", hex: BLOCK.cream },
  tech: { label: "Tech", hex: BLOCK.coral },
  other: { label: "Signal", hex: BLOCK.neutral },
};

export interface EmailStatusMeta {
  label: string;
  hex: string;
}

export const EMAIL_STATUS_META: Record<EmailStatus, EmailStatusMeta> = {
  draft: { label: "Draft", hex: BLOCK.cream },
  approved: { label: "Approved", hex: BLOCK.lime },
  sent: { label: "Sent", hex: BLOCK.lilac },
  replied: { label: "Replied", hex: BLOCK.mint },
  bounced: { label: "Bounced", hex: BLOCK.pink },
  skipped: { label: "Skipped", hex: BLOCK.neutral },
};

// Compose a solid pastel chip from a base block hex: ink text on the pastel
// fill, with a faint ink hairline. Colour flips with the theme like `text-ink`.
export function tintStyle(hex: string): {
  color: string;
  backgroundColor: string;
  borderColor: string;
} {
  return {
    color: "rgb(var(--ink))",
    backgroundColor: hex,
    borderColor: "rgb(var(--ink) / 0.12)",
  };
}

// fitScore -> pastel block ramp (strong → weak). Used as a chip/ring tint; the
// numeric value is always rendered in ink for contrast.
export function fitColor(score: number | undefined): string {
  if (score === undefined) return BLOCK.neutral;
  if (score >= 80) return BLOCK.mint;
  if (score >= 60) return BLOCK.lime;
  if (score >= 40) return BLOCK.cream;
  return BLOCK.pink;
}
