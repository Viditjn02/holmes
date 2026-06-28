"use client";

import type { ReactElement } from "react";
import type { Capability } from "@/lib/contract";
import { cn } from "@/lib/utils";

// ============================================================================
// QuickActions — the capability QUICK MENU. A scannable grid of the seven GTM
// plays (the 6 hackathon tracks + the GitHub scout), styled light/editorial
// (Figma): pastel icon chip, bold title, a one-line "what", and a mono sponsors
// line. Standalone & presentational — clicking a card calls onFire(intent); the
// integrator wires that to createRun with the default target URL + drill-in.
//
// Self-contained on purpose: imports only the Capability union (type-only) and
// the cn() helper, so it compiles before any backend/contract wiring lands.
// ============================================================================

interface QuickAction {
  /** The run capability fired on click — exactly the runs.intent union member. */
  intent: Capability;
  /** Bold card title (the founder-facing track name). */
  label: string;
  /** One-line "what it does" shown under the title. */
  what: string;
  /** Mono sponsors / provenance line (the small uppercase footer). */
  sponsors: string;
  /** Pastel accent — full Tailwind literal for the chip + left bar. */
  accent: string;
  icon: (props: { className?: string }) => ReactElement;
}

// The seven plays, verbatim labels, in the founder's screenshot order.
const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    intent: "discovery",
    label: "Reading Minds",
    what: "Find where your buyers are already complaining — free, across HN + Reddit.",
    sponsors: "Free · compounding brain",
    accent: "bg-block-mint",
    icon: DiscoveryIcon,
  },
  {
    intent: "outbound",
    label: "Revenue on Autopilot",
    what: "Source decision-makers + verified emails, then draft + send 24/7 outreach.",
    sponsors: "Orange Slice · Fiber · AgentMail",
    accent: "bg-block-lilac",
    icon: PipelineIcon,
  },
  {
    intent: "competitor",
    label: "Ad Intelligence",
    what: "Discover competitors and scan their live winning ads — Google, Meta, TikTok.",
    sponsors: "Google ATC · token-free",
    accent: "bg-block-pink",
    icon: RadarIcon,
  },
  {
    intent: "content",
    label: "Ad Factory",
    what: "Generate a scroll-stopping ad — image, copy, variations, and a free video.",
    sponsors: "OpenAI gpt-image-1 · Pexels",
    accent: "bg-block-cream",
    icon: SparkIcon,
  },
  {
    intent: "social",
    label: "Algorithm Hacking",
    what: "Engineer a viral content calendar, each post scored for reach.",
    sponsors: "OpenAI · Supadata",
    accent: "bg-block-coral",
    icon: PulseIcon,
  },
  {
    intent: "onboarding",
    label: "Zero to One",
    what: "Design a PLG onboarding flow that actually activates new users.",
    sponsors: "OpenAI",
    accent: "bg-block-lime",
    icon: SeedIcon,
  },
  {
    intent: "scout",
    label: "GitHub Scout",
    what: "Point at an event, org, or topic — dissect what everyone's building.",
    sponsors: "GitHub · OpenAI",
    accent: "bg-block-mint",
    icon: ScoutIcon,
  },
];

interface QuickActionsProps {
  /** Fired with the card's capability on click. The integrator turns this into a
   *  run against the default target URL and drills into the new board. */
  onFire: (intent: Capability) => void;
  /** Optional default target shown in the subhead, purely informational. */
  targetUrl?: string;
  /** Suppress entrance motion (respects prefers-reduced-motion upstream). */
  reducedMotion?: boolean;
  className?: string;
}

export default function QuickActions({
  onFire,
  targetUrl,
  reducedMotion = false,
  className,
}: QuickActionsProps) {
  return (
    <section
      aria-label="Quick actions"
      className={cn("w-full", className)}
    >
      <p className="eyebrow text-ink/60">Fire any play · one click</p>
      <h2 className="mt-2 text-headline text-ink">Quick actions</h2>
      <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink/70">
        Pick a play and the swarm runs it
        {targetUrl ? (
          <>
            {" "}against{" "}
            <span className="font-mono text-[12px] text-ink/80">{targetUrl}</span>
          </>
        ) : null}{" "}
        — live, right here.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {QUICK_ACTIONS.map((action, i) => {
          const Icon = action.icon;
          return (
            <button
              key={action.intent}
              type="button"
              onClick={() => onFire(action.intent)}
              style={!reducedMotion ? { animationDelay: `${i * 45}ms` } : undefined}
              className={cn(
                "group relative overflow-hidden rounded-lg border border-hairline bg-surface-soft/50 p-4 text-left transition-all",
                "hover:-translate-y-px hover:border-ink/20 hover:bg-surface-soft hover:shadow-soft",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20",
                !reducedMotion && "animate-fade-up",
              )}
            >
              {/* left accent bar */}
              <span
                aria-hidden
                className={cn("absolute inset-y-0 left-0 w-1", action.accent)}
              />
              <div className="flex items-start gap-3">
                {/* pastel icon chip */}
                <span
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-white/50",
                    action.accent,
                  )}
                >
                  <Icon className="h-4 w-4 text-ink/80" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-fig-card leading-snug text-ink">
                    {action.label}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink/65">
                    {action.what}
                  </p>
                  <p className="mt-2.5 truncate font-mono text-[10.5px] uppercase tracking-wide text-ink/40">
                    {action.sponsors}
                  </p>
                </div>
                {/* hover "fire it" affordance */}
                <span className="mt-0.5 shrink-0 text-ink/0 transition-colors group-hover:text-ink/40">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── glyphs (stroke icons, currentColor) ─────────────────────────────────────
// Inlined (copied from CanvasGhost) to keep this file standalone-compilable —
// no shared icon import that another dashboard file would also edit.

function DiscoveryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PipelineIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="5" width="4" height="11" rx="1.1" />
      <rect x="10" y="5" width="4" height="8" rx="1.1" />
      <rect x="16" y="5" width="4" height="13" rx="1.1" />
    </svg>
  );
}

function RadarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12 5.5 5.5" />
      <path d="M12 4a8 8 0 1 0 8 8" />
      <path d="M12 8a4 4 0 1 0 4 4" />
    </svg>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}

function PulseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l2.5-6 4 14 2.5-8H21" />
    </svg>
  );
}

function SeedIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21V11" />
      <path d="M12 11c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6Z" />
      <path d="M12 13C12 9.5 9.5 7 6 7c0 3.5 2.5 6 6 6Z" />
    </svg>
  );
}

function ScoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3a4.5 4.5 0 0 0-1.5 8.74V14l-2 6 3.5-2.5L15.5 20l-2-6v-2.26A4.5 4.5 0 0 0 12 3Z" />
      <circle cx="12" cy="7.5" r="1" />
    </svg>
  );
}
