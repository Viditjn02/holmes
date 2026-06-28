"use client";

import { useState, type ReactElement } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Intent } from "@/lib/contract";
import { cn } from "@/lib/utils";
import { relativeTime } from "./format";
import { deleteConversationRef, listConversationsRef } from "./chatApi";
import type { ConversationDoc } from "./types";
import { Blip, type BlipState } from "./blip/Blip";
import ThemeToggle from "./ThemeToggle";

// ============================================================================
// CommandSidebar — ONE clean ~256px column that replaces the old double rail
// (IconRail + ConversationSidebar). Light Figma editorial: white-ish glass
// ground, ink text, a pastel color-block per track, pill affordances, Inter +
// JetBrains-Mono labels.
//
// Layout, top → bottom:
//   • BRAND      — INTERCEPT wordmark.
//   • BLIP       — the mascot (where the old 3D orb sat) with a LIVE status ping
//                  driven by the focused run (pulses while the swarm works).
//   • NAV        — Home, the 7 canonical tracks (→ onFireTrack(intent)), and the
//                  brain (→ onOpenBrain). ONE label each, canonical everywhere.
//   • RECENT     — past conversations (select / delete) + New chat.
//   • FOOTER     — a persistent ⌘K affordance + theme toggle.
//
// Standalone-compilable: reads conversations + the focused run via existing
// refs/`api`; never imports another new dashboard file. activeTrack/brainActive/
// surface drive the single highlighted nav item.
// ============================================================================

// ── canonical track registry (ONE label each) ──────────────────────────────
// Local + read-only so this file compiles before lib/contract's DASHBOARD_TRACKS
// lands; full bg-block-* literals (no interpolation) so Tailwind's JIT emits them.
interface TrackNav {
  key: Capability7;
  label: string;
  tagline: string;
  accent: string;
  icon: (props: { className?: string }) => ReactElement;
}

type Capability7 =
  | "discovery"
  | "outbound"
  | "competitor"
  | "content"
  | "social"
  | "onboarding"
  | "scout";

const TRACKS: readonly TrackNav[] = [
  { key: "discovery", label: "Reading Minds", tagline: "Intent radar", accent: "bg-block-mint", icon: MindIcon },
  { key: "outbound", label: "Revenue on Autopilot", tagline: "Outbound swarm", accent: "bg-block-lime", icon: RevenueIcon },
  { key: "competitor", label: "Ad Intelligence", tagline: "Scan their ads", accent: "bg-block-coral", icon: ScanIcon },
  { key: "content", label: "Ad Factory", tagline: "Make the ad", accent: "bg-block-pink", icon: FactoryIcon },
  { key: "social", label: "Algorithm Hacking", tagline: "Go viral", accent: "bg-block-lilac", icon: ViralIcon },
  { key: "onboarding", label: "Zero to One", tagline: "PLG onboarding", accent: "bg-block-cream", icon: LaunchIcon },
  { key: "scout", label: "GitHub Scout", tagline: "Dissect projects", accent: "bg-block-navy", icon: ScoutIcon },
] as const;

interface CommandSidebarProps {
  /** Which top-level surface the page is showing. Home highlights on "dashboard". */
  surface: "dashboard" | "workspace";
  /** Return to the dashboard landing. */
  onHome: () => void;
  /** The currently open conversation (highlighted in Recent), if any. */
  activeId: Id<"conversations"> | null;
  /** Open a past conversation. */
  onSelectConversation: (id: Id<"conversations">) => void;
  /** Start a fresh chat. */
  onNewChat: () => void;
  /** Fire a track for the default target — flips the page into the workspace. */
  onFireTrack: (intent: Intent) => void;
  /** The track whose board is in focus, so its nav row reads active. */
  activeTrack?: Intent | null;
  /** Whether the canvas is showing the brain lens. */
  brainActive?: boolean;
  /** Open the compounding-knowledge brain board. */
  onOpenBrain: () => void;
  /** The run powering Blip's live ping; pulses while it is running. */
  focusedRunId?: Id<"runs"> | null;
  /** Collapsed → a thin icon rail; expanded → the full column. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Optional: open the ⌘K command palette from the footer affordance. */
  onOpenPalette?: () => void;
}

// Map the focused run's status → a Blip mood + a status-ping descriptor.
function runMood(status: string | undefined): {
  blip: BlipState;
  label: string;
  dot: string;
  pulse: boolean;
} {
  switch (status) {
    case "running":
      return { blip: "thinking", label: "Swarm working", dot: "bg-accent-magenta", pulse: true };
    case "complete":
      return { blip: "happy", label: "Run complete", dot: "bg-success", pulse: false };
    case "partial":
      return { blip: "idle", label: "Partial result", dot: "bg-accent-magenta", pulse: false };
    case "failed":
      return { blip: "concerned", label: "Run stalled", dot: "bg-ink/40", pulse: false };
    default:
      return { blip: "idle", label: "Idle · listening", dot: "bg-ink/25", pulse: false };
  }
}

export default function CommandSidebar({
  surface,
  onHome,
  activeId,
  onSelectConversation,
  onNewChat,
  onFireTrack,
  activeTrack = null,
  brainActive = false,
  onOpenBrain,
  focusedRunId = null,
  collapsed,
  onToggleCollapsed,
  onOpenPalette,
}: CommandSidebarProps) {
  const conversations = useQuery(listConversationsRef, {}) as
    | ConversationDoc[]
    | undefined;
  const deleteConversation = useMutation(deleteConversationRef);
  const run = useQuery(
    api.runs.getRun,
    focusedRunId ? { runId: focusedRunId } : "skip",
  );
  const mood = runMood(run?.status);

  const onDelete = async (e: React.MouseEvent, id: Id<"conversations">) => {
    e.stopPropagation();
    try {
      await deleteConversation({ conversationId: id });
    } catch {
      /* backend not ready — ignore */
    }
  };

  // ── collapsed: a thin keyboard-free rail ──────────────────────────────────
  if (collapsed) {
    return (
      <div className="glass-1 flex h-full w-14 flex-col items-center gap-2 py-3">
        <button
          onClick={onToggleCollapsed}
          aria-label="Expand sidebar"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-ink/60 transition-colors hover:bg-canvas hover:text-ink"
        >
          <span className="relative">
            <Blip state={mood.blip} size={26} />
            <StatusBadge dot={mood.dot} pulse={mood.pulse} className="-right-0.5 -top-0.5" />
          </span>
        </button>
        <button
          onClick={onHome}
          aria-label="Home"
          aria-current={surface === "dashboard" ? "page" : undefined}
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
            surface === "dashboard" ? "bg-canvas text-ink" : "text-ink/55 hover:bg-canvas/60 hover:text-ink",
          )}
        >
          <HomeIcon className="h-[18px] w-[18px]" />
        </button>
        <div className="my-1 h-px w-6 bg-hairline" />
        {TRACKS.map((t) => {
          const Icon = t.icon;
          const active = surface === "workspace" && activeTrack === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onFireTrack(t.key)}
              aria-label={t.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                active ? "text-ink" : "text-ink/55 hover:bg-canvas/60 hover:text-ink",
              )}
            >
              <span
                aria-hidden
                className={cn("absolute inset-0 rounded-xl transition-opacity", t.accent, active ? "opacity-30" : "opacity-0")}
              />
              <Icon className="relative h-[18px] w-[18px]" />
            </button>
          );
        })}
        <button
          onClick={onOpenBrain}
          aria-label="The brain"
          aria-current={brainActive ? "page" : undefined}
          className={cn(
            "relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
            brainActive ? "text-ink" : "text-ink/55 hover:bg-canvas/60 hover:text-ink",
          )}
        >
          <span aria-hidden className={cn("absolute inset-0 rounded-xl bg-block-lilac transition-opacity", brainActive ? "opacity-30" : "opacity-0")} />
          <BrainIcon className="relative h-[18px] w-[18px]" />
        </button>
        <div className="mt-auto flex flex-col items-center gap-2">
          <button
            onClick={onNewChat}
            aria-label="New chat"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-canvas text-ink transition-transform hover:scale-105"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
          <ThemeToggle />
        </div>
      </div>
    );
  }

  // ── expanded: the full single column ──────────────────────────────────────
  return (
    <div className="glass-1 flex h-full w-64 flex-col">
      {/* brand + collapse */}
      <div className="flex items-center justify-between px-3.5 pt-3.5 pb-2">
        <button onClick={onHome} className="flex items-center gap-2" aria-label="INTERCEPT home">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-canvas text-ink">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="m20 20-4.6-4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-[16px] font-fig-card tracking-tight text-ink">INTERCEPT</span>
        </button>
        <button
          onClick={onToggleCollapsed}
          aria-label="Collapse sidebar"
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink transition-colors hover:bg-canvas"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* BLIP + live status ping (where the old orb sat) */}
      <div className="mx-3 mb-1 flex items-center gap-2.5 rounded-xl border border-hairline bg-canvas/70 px-3 py-2">
        <span className="relative shrink-0">
          <Blip state={mood.blip} size={38} glow={mood.blip === "thinking" ? 0.5 : 0} />
          <StatusBadge dot={mood.dot} pulse={mood.pulse} className="-right-0.5 top-0.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-fig-headline text-ink">Blip</span>
          <span className="caption flex items-center gap-1.5 text-ink">
            <span className={cn("h-1.5 w-1.5 rounded-full", mood.dot, mood.pulse && "animate-blink")} />
            <span className="truncate">{mood.label}</span>
          </span>
        </span>
      </div>

      {/* NAV — Home, the 7 tracks, the brain */}
      <nav aria-label="Tracks" className="px-2 pt-1">
        <NavRow
          label="Home"
          sublabel="Command center"
          active={surface === "dashboard"}
          accent="bg-ink/10"
          icon={<HomeIcon className="h-4 w-4" />}
          onClick={onHome}
        />
        <div className="my-1.5 px-2">
          <span className="caption font-mono uppercase tracking-wider text-ink/45">Tracks</span>
        </div>
        {TRACKS.map((t) => {
          const Icon = t.icon;
          return (
            <NavRow
              key={t.key}
              label={t.label}
              sublabel={t.tagline}
              active={surface === "workspace" && activeTrack === t.key}
              accent={t.accent}
              icon={<Icon className="h-4 w-4" />}
              onClick={() => onFireTrack(t.key)}
            />
          );
        })}
        <NavRow
          label="The brain"
          sublabel="Compounding knowledge"
          active={brainActive}
          accent="bg-block-lilac"
          icon={<BrainIcon className="h-4 w-4" />}
          onClick={onOpenBrain}
        />
      </nav>

      {/* RECENT conversations */}
      <div className="mt-3 flex items-center justify-between px-3.5 pb-1">
        <span className="caption font-mono uppercase tracking-wider text-ink/45">Recent</span>
        <button
          onClick={onNewChat}
          className="flex items-center gap-1 rounded-pill border border-hairline bg-canvas px-2 py-0.5 text-[11px] font-fig-link text-ink transition-colors hover:bg-surface-soft"
        >
          <PlusIcon className="h-3 w-3" />
          New
        </button>
      </div>
      <div className="col-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {conversations === undefined ? (
          <div className="space-y-1.5 px-1 py-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded-md bg-surface-soft" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-5 text-center text-[11.5px] leading-relaxed text-ink/60">
            No conversations yet. Fire a track or start a chat.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => {
              const active = c._id === activeId && surface === "workspace";
              return (
                <li key={c._id}>
                  <button
                    onClick={() => onSelectConversation(c._id)}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors",
                      active ? "bg-canvas" : "hover:bg-canvas",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-[12.5px] text-ink", active && "font-fig-headline")}>
                        {c.title || "Untitled"}
                      </span>
                      <span className="caption text-ink/55">{relativeTime(c.lastMessageAt)}</span>
                    </span>
                    <span
                      onClick={(e) => onDelete(e, c._id)}
                      role="button"
                      tabIndex={-1}
                      aria-label="Delete conversation"
                      className="shrink-0 rounded p-1 text-transparent transition-colors group-hover:text-ink/40 hover:!text-red-500"
                    >
                      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                        <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* FOOTER — persistent ⌘K affordance + theme */}
      <div className="flex items-center justify-between border-t border-hairline px-3 py-2.5">
        <button
          onClick={() => onOpenPalette?.()}
          className="group flex items-center gap-2 rounded-pill border border-hairline bg-canvas px-2.5 py-1 text-[11.5px] text-ink transition-colors hover:bg-surface-soft"
          aria-label="Open command palette"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-ink/60">
            <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
            <path d="m20 20-3.6-3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          <span className="font-fig-link">Command</span>
          <kbd className="rounded bg-surface-soft px-1.5 py-0.5 font-mono text-[10px] leading-none text-ink/70">⌘K</kbd>
        </button>
        <ThemeToggle />
      </div>
    </div>
  );
}

// ── one nav row (icon + accent chip + label + sublabel) ─────────────────────
function NavRow({
  label,
  sublabel,
  active,
  accent,
  icon,
  onClick,
}: {
  label: string;
  sublabel: string;
  active: boolean;
  accent: string;
  icon: ReactElement;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors",
        active ? "bg-canvas" : "hover:bg-canvas",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink transition-opacity",
          accent,
          active ? "opacity-100" : "opacity-70 group-hover:opacity-100",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[12.5px] text-ink", active ? "font-fig-headline" : "font-fig-link")}>
          {label}
        </span>
        <span className="caption block truncate text-ink/50">{sublabel}</span>
      </span>
    </button>
  );
}

// ── a small corner status dot with an optional soft ping ring ───────────────
function StatusBadge({ dot, pulse, className }: { dot: string; pulse: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("absolute flex h-2.5 w-2.5", className)}>
      {pulse && <span className={cn("absolute inset-0 rounded-full opacity-60 animate-pulse-ring", dot)} />}
      <span className={cn("relative h-2.5 w-2.5 rounded-full ring-2 ring-canvas", dot)} />
    </span>
  );
}

// ── glyphs (stroke icons, currentColor) ─────────────────────────────────────
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 11.5 12 5l8 6.5M6 10v8.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function MindIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 4c3.3 0 6 2.4 6 5.6 0 1.8-.9 3.2-2.2 4.2V18l-2.4-1.2a7 7 0 0 1-1.4.1C8.7 16.9 6 14.5 6 11.3 6 7.9 8.7 4 12 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9.5 10.5h5M9.5 13h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function RevenueIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 16.5 9 11l3.5 3L20 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6h5v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ScanIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m20 20-3.5-3.5M11 8v6M8 11h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function FactoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 19.5V11l5 3V11l5 3V8l6 4v7.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function ViralIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.6 2.6M14.9 14.9l2.6 2.6M17.5 6.5l-2.6 2.6M9.1 14.9l-2.6 2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function LaunchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 3c3 1.5 5 4.6 5 8.6 0 1.5-.4 2.7-1 3.7l-4 .1-4-.1c-.6-1-1-2.2-1-3.7C7 7.6 9 4.5 12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.5 16.5 8 20m6.5-3.5L16 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function ScoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 19c-3.5 1-3.5-1.8-5-2.3m10 4.3v-3.1a2.6 2.6 0 0 0-.7-2c2.4-.3 5-1.2 5-5.4a4.2 4.2 0 0 0-1.2-2.9 3.9 3.9 0 0 0-.1-2.9s-1-.3-3.2 1.2a11 11 0 0 0-5.6 0C5.8 3.7 4.8 4 4.8 4a3.9 3.9 0 0 0-.1 2.9A4.2 4.2 0 0 0 3.5 9.8c0 4.2 2.6 5.1 5 5.4a2.6 2.6 0 0 0-.7 2V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BrainIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M9 4.5a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0-1 4.8A2.5 2.5 0 0 0 7 16.5a2.5 2.5 0 0 0 5 .5V6.5A2.5 2.5 0 0 0 9 4.5ZM15 4.5A2.5 2.5 0 0 1 17.5 7a2.5 2.5 0 0 1 1 4.8A2.5 2.5 0 0 1 17 16.5a2.5 2.5 0 0 1-5 .5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
