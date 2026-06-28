"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import ThreadCard from "./ThreadCard";
import ApprovalModal from "./ApprovalModal";

// ============================================================================
// DiscoveryBoard — THE MOAT, as a canvas tile. Real, clickable, intent-scored
// live threads (ranked) with each drafted reply behind the approval gate, plus
// the communities where the buyers gather. Reads the by_run brief queries.
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

  return (
    <section className="space-y-4">
      {/* communities */}
      {communities && communities.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {communities.map((c) => (
            <a
              key={c._id}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              title={c.why}
              className="group inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 text-[13px] text-zinc-300 transition-colors hover:border-accent/50 hover:text-white"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {c.name}
              <span className="text-[11px] text-zinc-600 group-hover:text-zinc-400">{c.platform}</span>
            </a>
          ))}
        </div>
      )}

      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-zinc-50">Live conversations to win</h3>
          <p className="text-[12.5px] text-zinc-500">
            Real threads where buyers are asking the exact question you answer — ranked by intent.
          </p>
        </div>
        {readyDrafts > 0 && (
          <span className="whitespace-nowrap rounded-full bg-accent/15 px-3 py-1 text-[11px] font-semibold text-accent ring-1 ring-accent/30">
            {readyDrafts} {readyDrafts === 1 ? "reply" : "replies"} to approve
          </span>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl border border-line bg-panel/60" />
          ))}
        </div>
      ) : ranked.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/40 p-10 text-center text-[13px] text-zinc-500">
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

      {activeDraft && (
        <ApprovalModal draft={activeDraft} thread={activeThread} onClose={() => setActiveDraftId(null)} />
      )}
    </section>
  );
}
