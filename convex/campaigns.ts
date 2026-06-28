import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  DEFAULT_CADENCE_MINUTES,
  MIN_CADENCE_MINUTES,
} from "../lib/contract";

// ============================================================================
// INTERCEPT — CAMPAIGNS (the standing outbound instruction + the 24/7 watch).
// ----------------------------------------------------------------------------
// A campaign IS the 24/7 monitor: while status === "active", the cron
// (convex/crons.ts -> internal.campaigns.tick) spawns a fresh outbound run (and
// an outreach run that ships already-approved emails + writes follow-ups) for
// every active campaign whose cadence has elapsed. This replaces the deleted
// `monitors` table entirely.
//
// review   = every send waits in the human-approval queue (default).
// autopilot = the sender ships approved-quality drafts itself.
//
// DEPLOY-SAFETY: this module defines queries/mutations, so it is NEVER "use
// node". The internalAction `tick` has an explicit return type and every
// same-module ctx.runQuery/runMutation result is explicitly typed (Convex
// circular inference -> deploy fails otherwise).
// ============================================================================

const MS_PER_MINUTE = 60_000;

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("paused"),
  v.literal("archived"),
);
const autonomyValidator = v.union(v.literal("review"), v.literal("autopilot"));
const inputTypeValidator = v.union(
  v.literal("url"),
  v.literal("name"),
  v.literal("competitor"),
  v.literal("community"),
  v.literal("text"),
);

function normalizeCadence(cadenceMinutes: number | undefined): number {
  if (cadenceMinutes === undefined || !Number.isFinite(cadenceMinutes)) {
    return DEFAULT_CADENCE_MINUTES;
  }
  return Math.max(MIN_CADENCE_MINUTES, Math.round(cadenceMinutes));
}

// ---------------------------------------------------------------------------
// PUBLIC: create / list / status / autonomy / delete.
// ---------------------------------------------------------------------------

/**
 * Create an outbound campaign. The chat router calls this when a user asks to
 * "find customers for X" / "run outbound"; flipping status to "active" turns on
 * the 24/7 watch.
 */
export const createCampaign = mutation({
  args: {
    company: v.string(),
    icp: v.string(),
    domain: v.optional(v.string()),
    description: v.optional(v.string()),
    positioning: v.optional(v.string()),
    personas: v.optional(v.array(v.string())),
    valueProp: v.optional(v.string()),
    conversationId: v.optional(v.id("conversations")),
    autonomy: v.optional(autonomyValidator),
    status: v.optional(statusValidator),
    cadenceMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"campaigns">> => {
    const company = args.company.trim();
    if (!company) throw new Error("createCampaign: company must not be empty");
    return await ctx.db.insert("campaigns", {
      company,
      icp: args.icp.trim() || `Buyers who would purchase ${company}.`,
      domain: args.domain?.trim() || undefined,
      description: args.description?.trim() || undefined,
      positioning: args.positioning?.trim() || undefined,
      personas: args.personas,
      valueProp: args.valueProp?.trim() || undefined,
      conversationId: args.conversationId,
      status: args.status ?? "active",
      autonomy: args.autonomy ?? "review",
      cadenceMinutes: normalizeCadence(args.cadenceMinutes),
      createdAt: Date.now(),
    });
  },
});

/** All campaigns, active first then newest (the campaign list / 24/7 panel). */
export const listCampaigns = query({
  args: {},
  handler: async (ctx): Promise<Doc<"campaigns">[]> => {
    const all = await ctx.db.query("campaigns").collect();
    return all.sort((a, b) => {
      const rank = (s: string) => (s === "active" ? 0 : s === "paused" ? 1 : 2);
      const r = rank(a.status) - rank(b.status);
      return r !== 0 ? r : b.createdAt - a.createdAt;
    });
  },
});

export const getCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<Doc<"campaigns"> | null> => {
    return await ctx.db.get(campaignId);
  },
});

/**
 * The campaign behind an outbound run — powers the canvas 24/7 watch toggle.
 * Resolves run -> run.campaignId -> campaign. Null when the run isn't tied to a
 * campaign (e.g. a one-off discovery/content run).
 */
export const getForRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"campaigns"> | null> => {
    const run = await ctx.db.get(runId);
    if (!run || !run.campaignId) return null;
    return await ctx.db.get(run.campaignId);
  },
});

/** Toggle the 24/7 watch (active/paused/archived/draft). */
export const setStatus = mutation({
  args: { campaignId: v.id("campaigns"), status: statusValidator },
  handler: async (ctx, { campaignId, status }): Promise<void> => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) return;
    await ctx.db.patch(campaignId, { status });
  },
});

/** Switch a campaign between human-review and autopilot sending. */
export const setAutonomy = mutation({
  args: { campaignId: v.id("campaigns"), autonomy: autonomyValidator },
  handler: async (ctx, { campaignId, autonomy }): Promise<void> => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) return;
    await ctx.db.patch(campaignId, { autonomy });
  },
});

export const deleteCampaign = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<void> => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) return;
    await ctx.db.delete(campaignId);
  },
});

// ---------------------------------------------------------------------------
// INTERNAL — the autonomous loop.
// ---------------------------------------------------------------------------

export const getCampaignInternal = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<Doc<"campaigns"> | null> => {
    return await ctx.db.get(campaignId);
  },
});

export const activeCampaigns = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"campaigns">[]> => {
    return await ctx.db
      .query("campaigns")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
  },
});

export const markTicked = internalMutation({
  args: { campaignId: v.id("campaigns"), runId: v.id("runs") },
  handler: async (ctx, { campaignId, runId }): Promise<void> => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) return;
    await ctx.db.patch(campaignId, { lastRunAt: Date.now(), lastRunId: runId });
  },
});

/**
 * The 24/7 tick. For each active campaign whose cadence has elapsed: (1) spawn a
 * fresh OUTBOUND run to re-source + draft (skipVideo so no Veo credits burn),
 * and (2) spawn an OUTREACH run to ship already-approved emails + write any due
 * follow-ups. Per-campaign failures are swallowed so one bad campaign never
 * aborts the loop. Returns how many campaigns ticked.
 */
export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ticked: number }> => {
    // 24/7 AUTONOMOUS master switch (DEFAULT OFF). When off, the whole
    // keep-running loop no-ops: no 24/7 radar, no overnight sweep, no
    // re-sourcing / re-monitoring / follow-up generation. A track does its task
    // once and stops until the user explicitly turns autonomy on.
    const autonomous: boolean = await ctx.runQuery(
      internal.settings.isAutonomous,
      {},
    );
    if (!autonomous) return { ticked: 0 };

    const campaigns: Doc<"campaigns">[] = await ctx.runQuery(
      internal.campaigns.activeCampaigns,
      {},
    );

    const now = Date.now();
    let ticked = 0;

    for (const campaign of campaigns) {
      const cadence = campaign.cadenceMinutes ?? DEFAULT_CADENCE_MINUTES;
      const dueAt =
        campaign.lastRunAt == null
          ? 0
          : campaign.lastRunAt + cadence * MS_PER_MINUTE;
      if (now < dueAt) continue;

      try {
        const inputType: "name" | "url" = campaign.domain ? "url" : "name";
        const input = campaign.domain ?? campaign.company;

        // Proactive chat: summarize the PREVIOUS cycle (real counts) before the
        // new sweep, so the user sees "while you were away…" grounded in data.
        if (campaign.conversationId && campaign.lastRunId) {
          const prev: Doc<"runs"> | null = await ctx.runQuery(
            internal.runs.getRunInternal,
            { runId: campaign.lastRunId },
          );
          if (prev) {
            const summary =
              `Overnight sweep for ${campaign.company}: sourced ${prev.sourcedCount ?? 0}, ` +
              `qualified ${prev.qualifiedCount ?? 0}, contacted ${prev.contactedCount ?? 0}. ` +
              `Starting another pass now — new drafts will appear for your approval.`;
            await ctx.runMutation(internal.conversations.postProactiveMessage, {
              conversationId: campaign.conversationId,
              content: summary,
              runId: campaign.lastRunId,
              intent: "outbound",
            });
          }
        }

        // (1) Re-source + qualify + draft.
        const sourcingRunId: Id<"runs"> = await ctx.runMutation(
          api.runs.createRun,
          {
            input,
            inputType,
            intent: "outbound",
            campaignId: campaign._id,
            conversationId: campaign.conversationId,
            trigger: "cron",
            skipVideo: true,
          },
        );

        // (2) Ship approved + follow up (acts on prior cycles' approvals).
        await ctx.runMutation(api.runs.createRun, {
          input,
          inputType,
          intent: "outreach",
          campaignId: campaign._id,
          conversationId: campaign.conversationId,
          trigger: "cron",
          skipVideo: true,
        });

        await ctx.runMutation(internal.campaigns.markTicked, {
          campaignId: campaign._id,
          runId: sourcingRunId,
        });
        ticked += 1;
      } catch {
        // Swallow: a single campaign's failure must not abort the loop.
      }
    }

    return { ticked };
  },
});
