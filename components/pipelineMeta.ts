// Presentation metadata for pipeline stages and warm signals. Pure data — no
// JSX — so it can be imported anywhere. Colors are raw hex; components compose
// inline rgba styles from them (avoids tailwind JIT purge surprises).
import type { ProspectStage, SignalType, EmailStatus } from "@/lib/contract";

export interface StageMeta {
  label: string;
  hex: string;
  blurb: string;
}

// Ordered, left -> right, matches PIPELINE_STAGES in lib/contract.
export const STAGE_META: Record<ProspectStage, StageMeta> = {
  sourced: { label: "Sourced", hex: "#7c8aa0", blurb: "Matched to the ICP" },
  enriched: { label: "Enriched", hex: "#8b7cf6", blurb: "Firmographics + warm signal" },
  qualified: { label: "Qualified", hex: "#f5a524", blurb: "Cleared the fit bar" },
  contacted: { label: "Contacted", hex: "#ff6a2b", blurb: "Email shipped" },
  replied: { label: "Replied", hex: "#34d399", blurb: "They wrote back" },
  booked: { label: "Booked", hex: "#22d3ee", blurb: "Meeting on the calendar" },
  skipped: { label: "Skipped", hex: "#4b5563", blurb: "Off-ramped" },
};

export interface SignalMeta {
  label: string;
  hex: string;
}

export const SIGNAL_META: Record<SignalType, SignalMeta> = {
  funding: { label: "Funding", hex: "#34d399" },
  hiring: { label: "Hiring", hex: "#38bdf8" },
  news: { label: "News", hex: "#a78bfa" },
  post: { label: "Post", hex: "#f472b6" },
  job_change: { label: "New role", hex: "#fbbf24" },
  tech: { label: "Tech", hex: "#22d3ee" },
  other: { label: "Signal", hex: "#94a3b8" },
};

export interface EmailStatusMeta {
  label: string;
  hex: string;
}

export const EMAIL_STATUS_META: Record<EmailStatus, EmailStatusMeta> = {
  draft: { label: "Draft", hex: "#f5a524" },
  approved: { label: "Approved", hex: "#38bdf8" },
  sent: { label: "Sent", hex: "#ff6a2b" },
  replied: { label: "Replied", hex: "#34d399" },
  bounced: { label: "Bounced", hex: "#f87171" },
  skipped: { label: "Skipped", hex: "#6b7280" },
};

// Compose a translucent chip style from a base hex (#rrggbb).
export function tintStyle(hex: string): {
  color: string;
  backgroundColor: string;
  borderColor: string;
} {
  return {
    color: hex,
    backgroundColor: `${hex}1f`,
    borderColor: `${hex}40`,
  };
}

// fitScore -> color ramp (red -> amber -> green).
export function fitColor(score: number | undefined): string {
  if (score === undefined) return "#6b7280";
  if (score >= 80) return "#34d399";
  if (score >= 60) return "#f5a524";
  if (score >= 40) return "#fb923c";
  return "#f87171";
}
