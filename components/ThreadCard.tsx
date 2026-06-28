"use client";

import type { Doc } from "@/convex/_generated/dataModel";
import type { IntentLabel } from "@/lib/contract";

// ============================================================================
// ThreadCard — THE MOAT.
// A real, clickable, intent-scored link to a LIVE conversation where a buyer is
// asking the exact question the company answers. This is the most important
// component in the product: it must feel verifiable, alive, and high-signal.
// ============================================================================

interface IntentStyle {
  label: string;
  /** Pastel block chip classes for the intent badge. */
  chip: string;
  pulse: boolean;
}

const INTENT_STYLES: Record<IntentLabel, IntentStyle> = {
  ready_to_buy: {
    label: "Ready to buy",
    chip: "bg-block-mint text-ink",
    pulse: true,
  },
  frustrated: {
    label: "Frustrated",
    chip: "bg-block-coral text-ink",
    pulse: true,
  },
  comparing: {
    label: "Comparing",
    chip: "bg-block-cream text-ink",
    pulse: false,
  },
  browsing: {
    label: "Browsing",
    chip: "bg-block-lilac text-ink",
    pulse: false,
  },
};

const FALLBACK_INTENT: IntentStyle = {
  label: "Signal",
  chip: "bg-surface-soft text-ink border border-hairline",
  pulse: false,
};

const PLATFORM_META: Record<string, { label: string; symbol: string }> = {
  reddit: { label: "Reddit", symbol: "r/" },
  hackernews: { label: "Hacker News", symbol: "Y" },
  forum: { label: "Forum", symbol: "#" },
  discord: { label: "Discord", symbol: "@" },
  twitter: { label: "X", symbol: "x" },
};

function intentStyle(label: string): IntentStyle {
  return INTENT_STYLES[label as IntentLabel] ?? FALLBACK_INTENT;
}

function platformMeta(platform: string) {
  return (
    PLATFORM_META[platform.toLowerCase()] ?? {
      label: platform,
      symbol: "#",
    }
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface ScoreRingProps {
  score: number;
  style: IntentStyle;
}

function ScoreRing({ score, style }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const deg = (clamped / 100) * 360;
  return (
    <div
      className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full"
      style={{
        background: `conic-gradient(rgb(var(--ink)) ${deg}deg, rgb(var(--ink) / 0.1) ${deg}deg)`,
      }}
      aria-label={`Intent score ${clamped} of 100`}
    >
      <div className="grid h-[52px] w-[52px] place-items-center rounded-full bg-canvas">
        <span className="text-xl font-fig-card tabular-nums leading-none text-ink">
          {clamped}
        </span>
      </div>
      {style.pulse && (
        <span
          className="pointer-events-none absolute inset-0 animate-ping rounded-full opacity-20"
          style={{ boxShadow: "0 0 0 2px rgb(var(--ink))" }}
        />
      )}
    </div>
  );
}

interface ThreadCardProps {
  thread: Doc<"threads">;
  draft?: Doc<"drafts"> | null;
  onReviewDraft?: (draft: Doc<"drafts">) => void;
}

const DRAFT_BADGE: Record<string, { label: string; cls: string }> = {
  awaiting_approval: { label: "Reply ready · review", cls: "bg-block-cream text-ink" },
  approved: { label: "Approved", cls: "bg-block-mint text-ink" },
  rejected: { label: "Rejected", cls: "bg-surface-soft text-ink/60 border border-hairline" },
  posted: { label: "Posted", cls: "bg-block-mint text-ink" },
};

export default function ThreadCard({ thread, draft, onReviewDraft }: ThreadCardProps) {
  const style = intentStyle(thread.intentLabel);
  const platform = platformMeta(thread.platform);
  const draftBadge = draft ? DRAFT_BADGE[draft.status] : undefined;

  return (
    <article
      className="group relative flex flex-col gap-4 rounded-lg border border-hairline bg-canvas p-5 transition-colors duration-200 hover:border-ink/20"
    >
      {/* Header: platform + intent chip */}
      <div className="flex items-center gap-2 text-xs">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-ink/60">
          <span
            className="grid h-6 w-6 place-items-center rounded-md bg-surface-soft font-fig-card text-ink"
            aria-hidden
          >
            {platform.symbol}
          </span>
          <span className="text-ink">{platform.label}</span>
          <span className="text-ink/30">·</span>
          <span className="truncate text-ink/50">{hostOf(thread.url)}</span>
        </div>
        <span className={`caption whitespace-nowrap rounded-full px-2.5 py-1 ${style.chip}`}>
          {style.label}
        </span>
      </div>

      {/* Body: score + title + snippet */}
      <div className="flex gap-4">
        <ScoreRing score={thread.intentScore} style={style} />
        <div className="min-w-0 flex-1">
          <a
            href={thread.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[15px] font-fig-headline leading-snug text-ink decoration-ink/40 underline-offset-4 transition-colors hover:underline"
          >
            {thread.title}
          </a>
          <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-ink/60">
            “{thread.snippet}”
          </p>
          {thread.author && (
            <p className="mt-2 text-xs text-ink/50">
              asked by <span className="text-ink">{thread.author}</span>
            </p>
          )}
        </div>
      </div>

      {/* Footer: the clickable moat link + draft gate */}
      <div className="mt-1 flex items-center justify-between gap-3 border-t border-hairline pt-3">
        <a
          href={thread.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-canvas px-4 py-2 text-sm font-fig-link text-ink transition-colors hover:bg-surface-soft"
        >
          Open live thread
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M7 17 17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </a>

        {draft && draftBadge && (
          <button
            type="button"
            onClick={() => onReviewDraft?.(draft)}
            className={`inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-xs font-fig-link transition-opacity hover:opacity-90 ${draftBadge.cls}`}
          >
            {draft.status === "awaiting_approval" && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            )}
            {draftBadge.label}
          </button>
        )}
      </div>
    </article>
  );
}
