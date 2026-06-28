"use client";

/**
 * MascotCompanion — the fixed, floating corner companion. Mount this ONCE
 * (app/page.tsx or app/layout.tsx). It wires:
 *   • <Mascot/>              — the recolored sprite (state-driven animations)
 *   • useMascotReactions()   — maps the LIVE swarm → mood + ambient one-liners
 *   • useMascotGaze()        — pupils track the cursor (no framer-motion)
 *   • a tiny speech bubble   — FUN reactions only, auto-dismisses, NEVER an input
 *
 * Repurposed from Acme's Companion: the chat panel / book flow / FAQ is dropped.
 * This is delight, reactive to the system — not a guide. It sits in the corner,
 * blinks, breathes, glances at your cursor, and celebrates the swarm's wins.
 *
 * Self-contained styling: Tailwind classes are used for layout + the bubble, but
 * the COLORS come from INTERCEPT's theme tokens (bg-canvas / text-ink / border /
 * accent-magenta), so it reads correctly in BOTH light and night mode. Swap the
 * class names for plain inline styles if you don't want a Tailwind dependency.
 */

import { useRef } from "react";
import { Mascot, useMascotGaze } from "./Mascot";
import { useMascotReactions } from "./useMascotReactions";
import type { Id } from "@/convex/_generated/dataModel";

interface MascotCompanionProps {
  /** The focused run — enables richer per-run wins (threads/emails/posts/ads). */
  runId?: Id<"runs"> | null;
  /** The active conversation — enables event-feed ambient one-liners. */
  conversationId?: Id<"conversations"> | null;
  /** Rendered sprite size (px). */
  size?: number;
}

export default function MascotCompanion({
  runId = null,
  conversationId = null,
  size = 64,
}: MascotCompanionProps) {
  const spriteRef = useRef<HTMLDivElement>(null);
  const gaze = useMascotGaze(spriteRef);
  const { state, speech, dismissSpeech, busy } = useMascotReactions({
    runId,
    conversationId,
  });

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2"
      aria-hidden="true"
    >
      {/* Fun, ambient one-liner. Decorative only — it is NOT a chat input. */}
      {speech && (
        <button
          type="button"
          onClick={dismissSpeech}
          className="pointer-events-auto max-w-[220px] rounded-2xl rounded-br-sm border border-hairline bg-canvas px-3.5 py-2 text-left text-sm text-ink shadow-xl outline-none transition-opacity hover:opacity-90"
          // The bubble is a delight beat; tapping it just dismisses early.
          aria-hidden="true"
          tabIndex={-1}
        >
          {speech}
        </button>
      )}

      {/* The mascot itself. Transparent hit area; a subtle magenta ring only on
          hover so it never reads as a plain button. */}
      <div
        ref={spriteRef}
        className="pointer-events-auto grid size-20 place-items-center rounded-full ring-2 ring-transparent transition-[transform,box-shadow] hover:ring-accent-magenta/25"
        title={busy ? "the swarm is working…" : "INTERCEPT"}
        style={{ filter: "drop-shadow(0 6px 14px rgba(15,20,40,0.28))" }}
      >
        <Mascot state={state} size={size} gaze={gaze} />
      </div>
    </div>
  );
}
