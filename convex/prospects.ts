import { v } from "convex/values";
import { query, internalQuery, internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { PIPELINE_STAGES } from "../lib/contract";

// ============================================================================
// INTERCEPT — PROSPECTS (the outbound pipeline data surface).
// ----------------------------------------------------------------------------
// A prospect is a sourced decision-maker (company + person) moving stage by
// stage through the kanban. Firmographics come from OrangeSlice/Apollo; a
// verified email comes from Fiber (emailVerified === Fiber confirmed it).
//
// This module owns the table's reads + writes. NOT "use node" (queries +
// mutations). The sourcer/qualifier/writer/sender agents call the internal
// mutations; the canvas (ProspectPipeline) subscribes to the public queries.
// ============================================================================

const stageValidator = v.union(
  v.literal("sourced"),
  v.literal("enriched"),
  v.literal("qualified"),
  v.literal("contacted"),
  v.literal("replied"),
  v.literal("booked"),
  v.literal("skipped"),
);

const signalValidator = v.object({
  type: v.union(
    v.literal("funding"),
    v.literal("hiring"),
    v.literal("news"),
    v.literal("post"),
    v.literal("job_change"),
    v.literal("tech"),
    v.literal("other"),
  ),
  summary: v.string(),
  url: v.optional(v.string()),
  source: v.optional(v.string()),
  foundAt: v.number(),
});

// ---------------------------------------------------------------------------
// WRITES (internal — agents only).
// ---------------------------------------------------------------------------

/**
 * Insert a sourced prospect. Dedups within a run on (company, name) so a re-run
 * or overlapping source can't double-insert the same decision-maker.
 */
export const insert = internalMutation({
  args: {
    runId: v.optional(v.id("runs")),
    campaignId: v.optional(v.id("campaigns")),
    company: v.string(),
    domain: v.optional(v.string()),
    industry: v.optional(v.string()),
    employeeCount: v.optional(v.string()),
    location: v.optional(v.string()),
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerified: v.optional(v.boolean()),
    linkedinUrl: v.optional(v.string()),
    signal: v.optional(signalValidator),
    fitScore: v.optional(v.number()),
    fitReason: v.optional(v.string()),
    stage: v.optional(stageValidator),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"prospects">> => {
    // Dedup within the run.
    if (args.runId) {
      const existing = await ctx.db
        .query("prospects")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect();
      const key = `${args.company.toLowerCase().trim()}|${(args.name ?? "").toLowerCase().trim()}`;
      const dup = existing.find(
        (p) =>
          `${p.company.toLowerCase().trim()}|${(p.name ?? "").toLowerCase().trim()}` ===
          key,
      );
      if (dup) return dup._id;
    }

    return await ctx.db.insert("prospects", {
      runId: args.runId,
      campaignId: args.campaignId,
      company: args.company,
      domain: args.domain,
      industry: args.industry,
      employeeCount: args.employeeCount,
      location: args.location,
      name: args.name,
      title: args.title,
      email: args.email,
      emailVerified: args.emailVerified,
      linkedinUrl: args.linkedinUrl,
      signal: args.signal,
      fitScore: args.fitScore,
      fitReason: args.fitReason,
      stage: args.stage ?? "sourced",
      source: args.source,
      updatedAt: Date.now(),
    });
  },
});

/** Patch a prospect (stage advance, qualification, email attach). */
export const update = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    stage: v.optional(stageValidator),
    fitScore: v.optional(v.number()),
    fitReason: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerified: v.optional(v.boolean()),
    signal: v.optional(signalValidator),
    skipReason: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { prospectId, ...rest } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(prospectId, patch);
  },
});

// ---------------------------------------------------------------------------
// READS.
// ---------------------------------------------------------------------------

/** Internal: read one prospect (sender/follower need the recipient + stage). */
export const getInternal = internalQuery({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, { prospectId }): Promise<Doc<"prospects"> | null> => {
    return await ctx.db.get(prospectId);
  },
});

/** Internal: all prospects for a run (qualifier/writer iterate these). */
export const forRunInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"prospects">[]> => {
    return await ctx.db
      .query("prospects")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
  },
});

/** Internal: qualified prospects for a campaign (sender/follower target these). */
export const qualifiedForCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<Doc<"prospects">[]> => {
    return await ctx.db
      .query("prospects")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
  },
});

/** Public: a run's prospects, ordered by fit (kanban / pipeline canvas). */
export const byRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"prospects">[]> => {
    const rows = await ctx.db
      .query("prospects")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    return rows.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));
  },
});

/** Public: a campaign's prospects (the standing 24/7 pipeline). */
export const byCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<Doc<"prospects">[]> => {
    const rows = await ctx.db
      .query("prospects")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
    return rows.sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0));
  },
});

/** Public: pipeline stage counts for a run (the kanban column headers). */
export const stageCountsForRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Record<string, number>> => {
    const rows = await ctx.db
      .query("prospects")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    const counts: Record<string, number> = {};
    for (const stage of PIPELINE_STAGES) counts[stage] = 0;
    counts.skipped = 0;
    for (const p of rows) counts[p.stage] = (counts[p.stage] ?? 0) + 1;
    return counts;
  },
});
