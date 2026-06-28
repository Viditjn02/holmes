"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import ThreadCard from "./ThreadCard";
import ApprovalModal from "./ApprovalModal";

// ============================================================================
// DiscoveryBoard — THE MOAT, as a canvas tile. Read as one company's discovery
// FLOW, top → bottom: Communities (where the buyers gather) → Live threads
// (ranked by intent) → Drafted replies (behind the approval gate). Light Figma
// palette, consistent with the outbound pipeline + outreach queue. Reads the
// by_run brief queries.
// ============================================================================

export default function DiscoveryBoard({ runId }: { runId: Id<"runs"> }) {
  const communities = useQuery(api.brief.getCommunities, { runId });
  const threads = useQuery(api.brief.getThreads, { runId });
  const drafts = useQuery(api.brief.getDrafts, { runId });

  const [activeDraftId, setActiveDraftId] = useState<Id<"drafts"> | null>(null);

  const draftByThread = useMemo(() => {
    const map = new Map<string, Doc<"drafts">>();
    for (const d of drafts ?? []) map.set(d.threadId, d);
    return map;
  }, [drafts]);

  const ranked = useMemo(
    () => [...(threads ?? [])].sort((a, b) => b.intentScore - a.intentScore),
    [threads],
  );

  const activeDraft = (drafts ?? []).find((d) => d._id === activeDraftId) ?? null;
  const activeThread = (threads ?? []).find((t) => t._id === activeDraft?.threadId) ?? null;

  const loading = threads === undefined;
  const readyDrafts = (drafts ?? []).filter((d) => d.status === "awaiting_approval").length;

  // Compact funnel readout — the discovery flow at a glance, consistent with the
  // pipeline + queue.
  const funnel: { label: string; n: number }[] = [
    { label: "communities", n: communities?.length ?? 0 },
    { label: "threads", n: ranked.length },
    { label: "drafted", n: drafts?.length ?? 0 },
  ];

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-fig-headline text-ink">Live conversations to win</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink/60">
            {funnel.map((f, i) => (
              <span key={f.label} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-ink/25">›</span>}
                <span className="tabular-nums text-ink/80">{f.n}</span>
                <span>{f.label}</span>
              </span>
            ))}
          </div>
        </div>
        {readyDrafts > 0 && (
          <span className="caption shrink-0 whitespace-nowrap rounded-full bg-block-cream px-3 py-1 text-ink">
            {readyDrafts} {readyDrafts === 1 ? "reply" : "replies"} to approve
          </span>
        )}
      </div>

      {/* Stage 1 — communities where the buyers gather. */}
      {communities && communities.length > 0 && (
        <div>
          <p className="caption mb-2 text-ink/40">Communities</p>
          <div className="flex flex-wrap gap-2">
            {communities.map((c) => (
              <a
                key={c._id}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                title={c.why}
                className="group inline-flex items-center gap-2 rounded-full border border-hairline bg-canvas px-3 py-1.5 text-[13px] text-ink/70 transition-colors hover:border-ink/25 hover:text-ink"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-ink/30 group-hover:bg-ink/60" />
                {c.name}
                <span className="text-[11px] text-ink/40 group-hover:text-ink/60">{c.platform}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Stage 2 + 3 — ranked live threads, each with its drafted reply. */}
      <div>
        <p className="caption mb-2 text-ink/40">Live threads · ranked by buyer intent</p>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-lg border border-hairline bg-surface-soft" />
            ))}
          </div>
        ) : ranked.length === 0 ? (
          <div className="rounded-lg border border-dashed border-hairline bg-surface-soft p-10 text-center text-[13px] text-ink/60">
            The detective is still on the case — live threads appear here the moment they surface.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {ranked.map((thread) => (
              <ThreadCard
                key={thread._id}
                thread={thread}
                draft={draftByThread.get(thread._id) ?? null}
                onReviewDraft={(d) => setActiveDraftId(d._id)}
              />
            ))}
          </div>
        )}
      </div>

      {activeDraft && (
        <ApprovalModal draft={activeDraft} thread={activeThread} onClose={() => setActiveDraftId(null)} />
      )}
    </section>
  );
}
