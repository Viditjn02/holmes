import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// ============================================================================
// INTERCEPT — EVENTS (the live activity feed substrate)
// ----------------------------------------------------------------------------
// A lightweight, append-only ticker. Every meaningful agent action drops one
// human-readable line here so the canvas (components/EventFeed.tsx) shows the
// swarm "working" in real time, and the 24/7 cron can later summarize these
// rows into a proactive chat message ("overnight I found 3 signals…").
//
// CONVEX RULES: this module is NOT "use node" (it defines a mutation + queries).
// `log` is the single write surface — agents call it via ctx.runMutation. It is
// purely additive: a failed/absent event NEVER blocks an agent or a run.
// ============================================================================

const MAX_FEED = 80; // cap the ticker so the canvas stays snappy
const MAX_MESSAGE_LEN = 500;

/**
 * Append one feed line. Agents typically know only their `runId`; we backfill
 * `conversationId`/`campaignId` from the run so conversation-scoped feeds work
 * even when the caller didn't pass them. Never throws past the insert.
 */
export const log = internalMutation({
  args: {
    runId: v.optional(v.id("runs")),
    conversationId: v.optional(v.id("conversations")),
    campaignId: v.optional(v.id("campaigns")),
    prospectId: v.optional(v.id("prospects")),
    agent: v.optional(v.string()),
    kind: v.string(), // sourced | enriched | qualified | drafted | sent | found | rendered | …
    message: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"events">> => {
    let conversationId: Id<"conversations"> | undefined = args.conversationId;
    let campaignId: Id<"campaigns"> | undefined = args.campaignId;

    // Backfill provenance from the run so feed-by-conversation works for any
    // agent that only carries a runId.
    if (
      args.runId &&
      (conversationId === undefined || campaignId === undefined)
    ) {
      const run = await ctx.db.get(args.runId);
      if (run) {
        if (conversationId === undefined) {
          conversationId = run.conversationId ?? undefined;
        }
        if (campaignId === undefined) {
          campaignId = run.campaignId ?? undefined;
        }
      }
    }

    return await ctx.db.insert("events", {
      runId: args.runId,
      conversationId,
      campaignId,
      prospectId: args.prospectId,
      agent: args.agent,
      kind: args.kind,
      message: args.message.slice(0, MAX_MESSAGE_LEN),
      createdAt: Date.now(),
    });
  },
});

/** A run's feed, newest first — drives the per-run live ticker on the canvas. */
export const feedForRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"events">[]> => {
    const rows = await ctx.db
      .query("events")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_FEED);
  },
});

/**
 * A conversation's whole feed, newest first — the ambient ticker the canvas
 * shows across every run spawned in the chat (and the substrate the proactive
 * cron summarizes).
 */
export const feedForConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<Doc<"events">[]> => {
    const rows = await ctx.db
      .query("events")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", conversationId),
      )
      .collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_FEED);
  },
});
