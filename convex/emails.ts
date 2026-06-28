import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

// ============================================================================
// INTERCEPT — EMAILS (the outbound sequence, distinct from chat `messages`).
// ----------------------------------------------------------------------------
// step 0 is the first touch; 1+ are follow-ups. GATED: the writer only ever
// creates "draft"; a human (or autopilot) moves it to "approved"; ONLY the
// sender moves "approved" -> "sent" via AgentMail (convex/outreach.ts). Replies
// land back here as "replied".
//
// This module owns the table's reads + writes. NOT "use node".
// ============================================================================

const kindValidator = v.union(v.literal("initial"), v.literal("followup"));
const statusValidator = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("sent"),
  v.literal("replied"),
  v.literal("bounced"),
  v.literal("skipped"),
);

// ---------------------------------------------------------------------------
// WRITES.
// ---------------------------------------------------------------------------

/** Insert a drafted email (writer). Always starts at status "draft". */
export const insert = internalMutation({
  args: {
    prospectId: v.id("prospects"),
    campaignId: v.optional(v.id("campaigns")),
    runId: v.optional(v.id("runs")),
    step: v.number(),
    kind: kindValidator,
    subject: v.string(),
    body: v.string(),
    signalRef: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"emails">> => {
    return await ctx.db.insert("emails", {
      prospectId: args.prospectId,
      campaignId: args.campaignId,
      runId: args.runId,
      step: args.step,
      kind: args.kind,
      subject: args.subject.slice(0, 200),
      body: args.body,
      signalRef: args.signalRef,
      to: args.to,
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

/** Internal: advance an email's status + stamp AgentMail correlation/reply data. */
export const setStatus = internalMutation({
  args: {
    emailId: v.id("emails"),
    status: statusValidator,
    to: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    agentmailId: v.optional(v.string()),
    agentmailThreadId: v.optional(v.string()),
    replyBody: v.optional(v.string()),
    repliedAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { emailId, ...rest } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(emailId, patch);
  },
});

// ---------------------------------------------------------------------------
// READS (internal — agents).
// ---------------------------------------------------------------------------

export const getInternal = internalQuery({
  args: { emailId: v.id("emails") },
  handler: async (ctx, { emailId }): Promise<Doc<"emails"> | null> => {
    return await ctx.db.get(emailId);
  },
});

export const forProspect = internalQuery({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, { prospectId }): Promise<Doc<"emails">[]> => {
    return await ctx.db
      .query("emails")
      .withIndex("by_prospect", (q) => q.eq("prospectId", prospectId))
      .collect();
  },
});

/** Approved-and-unsent emails for a campaign (the sender's queue). */
export const approvedForCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<Doc<"emails">[]> => {
    return await ctx.db
      .query("emails")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .filter((q) => q.eq(q.field("status"), "approved"))
      .collect();
  },
});

/** Sent emails for a campaign (the follower scans these for follow-up timing). */
export const sentForCampaign = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<Doc<"emails">[]> => {
    return await ctx.db
      .query("emails")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .filter((q) => q.eq(q.field("status"), "sent"))
      .collect();
  },
});

/** All emails for a campaign (sender/follower filter in-memory). */
export const forCampaignInternal = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<Doc<"emails">[]> => {
    return await ctx.db
      .query("emails")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
  },
});

/** All emails for a run. */
export const forRunInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"emails">[]> => {
    const rows = await ctx.db.query("emails").collect();
    return rows.filter((e) => e.runId === runId);
  },
});

/** Approved emails not tied to any run/campaign filter — global send queue. */
export const allApproved = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"emails">[]> => {
    return await ctx.db
      .query("emails")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
  },
});

// ---------------------------------------------------------------------------
// READS (public — canvas EmailQueue).
// ---------------------------------------------------------------------------

export const byRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"emails">[]> => {
    const rows = await ctx.db.query("emails").collect();
    return rows
      .filter((e) => e.runId === runId)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const byCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<Doc<"emails">[]> => {
    const rows = await ctx.db
      .query("emails")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const byProspect = query({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, { prospectId }): Promise<Doc<"emails">[]> => {
    return await ctx.db
      .query("emails")
      .withIndex("by_prospect", (q) => q.eq("prospectId", prospectId))
      .collect();
  },
});

// ---------------------------------------------------------------------------
// PUBLIC GATE — the human approval surface for the EmailQueue.
// ---------------------------------------------------------------------------

/**
 * Move a drafted email through the approval gate from the EmailQueue UI. Accepts
 * "approved" (draft -> approved) or "skipped" (draft|approved -> skipped). The
 * actual AgentMail send is a SEPARATE explicit step (outreach.sendApprovedEmail),
 * so this never sends — it only gates. Any other status is ignored (no-op).
 */
export const gate = mutation({
  args: { emailId: v.id("emails"), status: statusValidator },
  handler: async (ctx, { emailId, status }): Promise<{ ok: boolean }> => {
    const email = await ctx.db.get(emailId);
    if (!email) return { ok: false };
    if (status === "approved" && email.status === "draft") {
      await ctx.db.patch(emailId, { status: "approved" });
    } else if (
      status === "skipped" &&
      (email.status === "draft" || email.status === "approved")
    ) {
      await ctx.db.patch(emailId, { status: "skipped" });
    }
    return { ok: true };
  },
});

/** Approve a drafted email so the sender may ship it. Only draft -> approved. */
export const approve = mutation({
  args: { emailId: v.id("emails") },
  handler: async (ctx, { emailId }): Promise<{ ok: boolean }> => {
    const email = await ctx.db.get(emailId);
    if (!email) return { ok: false };
    if (email.status === "draft") {
      await ctx.db.patch(emailId, { status: "approved" });
    }
    return { ok: true };
  },
});

/** Reject (skip) a drafted email — it will never be sent. */
export const reject = mutation({
  args: { emailId: v.id("emails") },
  handler: async (ctx, { emailId }): Promise<{ ok: boolean }> => {
    const email = await ctx.db.get(emailId);
    if (!email) return { ok: false };
    if (email.status === "draft" || email.status === "approved") {
      await ctx.db.patch(emailId, { status: "skipped" });
    }
    return { ok: true };
  },
});

/**
 * Record an inbound reply (webhook / manual). Moves the email to "replied" and
 * advances the prospect to the "replied" stage so the pipeline reflects it.
 */
export const markReplied = mutation({
  args: { emailId: v.id("emails"), replyBody: v.optional(v.string()) },
  handler: async (ctx, { emailId, replyBody }): Promise<{ ok: boolean }> => {
    const email = await ctx.db.get(emailId);
    if (!email) return { ok: false };
    await ctx.db.patch(emailId, {
      status: "replied",
      replyBody: replyBody?.slice(0, 4000),
      repliedAt: Date.now(),
    });
    const prospect = await ctx.db.get(email.prospectId);
    if (prospect && prospect.stage !== "booked") {
      await ctx.db.patch(email.prospectId, {
        stage: "replied",
        updatedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});
