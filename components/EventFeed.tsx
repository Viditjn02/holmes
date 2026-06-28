"use client";

import { useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { relativeTime } from "./format";
import { eventsByRunRef } from "./chatApi";
import type { EventDoc } from "./types";

// ============================================================================
// EventFeed — the swarm's live activity ticker. Each agent appends one line per
// meaningful action (sourced / enriched / qualified / drafted / sent / found …);
// this renders them newest-first so the canvas always feels alive.
// ============================================================================

const KIND_COLOR: Record<string, string> = {
  sourced: "#8b7cf6",
  enriched: "#a78bfa",
  qualified: "#f5a524",
  drafted: "#ff6a2b",
  sent: "#34d399",
  replied: "#22d3ee",
  found: "#60a5fa",
  rendered: "#f472b6",
  scored: "#f5a524",
};

function kindColor(kind: string): string {
  return KIND_COLOR[kind] ?? "#94a3b8";
}

export default function EventFeed({ runId, max = 40 }: { runId: Id<"runs">; max?: number }) {
  const events = useQuery(eventsByRunRef, { runId }) as EventDoc[] | undefined;

  const rows = [...(events ?? [])]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max);

  if (events === undefined) {
    return (
      <div className="space-y-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-6 animate-pulse rounded bg-white/5" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-panel/40 px-4 py-6 text-center text-[12px] text-zinc-600">
        Activity from the swarm appears here in real time.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink/40">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="live-dot text-accent" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/55">Live activity</span>
        <span className="ml-auto text-[10px] tabular-nums text-white/30">{events.length}</span>
      </div>
      <ul className="col-scroll max-h-72 divide-y divide-line/60 overflow-y-auto">
        {rows.map((e) => (
          <li key={e._id} className="flex items-center gap-2.5 px-4 py-2 animate-row-in">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: kindColor(e.kind) }} />
            {e.agent && (
              <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-white/35">
                {e.agent}
              </span>
            )}
            <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", "text-zinc-300")}>{e.message}</span>
            <span className="shrink-0 text-[10px] tabular-nums text-white/25">{relativeTime(e.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
