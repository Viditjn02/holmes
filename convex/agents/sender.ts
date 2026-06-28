// ============================================================================
// INTERCEPT — SENDER AGENT  (the AgentMail send beat, gated)
// ----------------------------------------------------------------------------
// Ships outbound emails via AgentMail. The gate: in REVIEW mode (default) only
// human-APPROVED emails go out; in AUTOPILOT mode the campaign also lets the
// sender ship approved-quality drafts itself. On a successful send the email
// moves -> "sent" (with AgentMail ids) and the prospect advances to "contacted".
//
// REAL send via lib/agentmail (fetch, Bearer AGENTMAIL_API_KEY). With no key the
// send NO-OPs honestly (the email stays unsent) — it never throws, never blocks.
// ============================================================================

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { sendMessage } from "../../lib/agentmail";

export const run = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<{ sent: number }> => {
    const runDoc: Doc<"runs"> | null = await ctx.runQuery(
      internal.runs.getRunInternal,
      { runId },
    );
    if (!runDoc) throw new Error(`sender: run ${runId} not found`);

    // Determine autonomy + the candidate email set.
    let autopilot = false;
    let candidates: Doc<"emails">[];
    if (runDoc.campaignId) {
      const campaign: Doc<"campaigns"> | null = await ctx.runQuery(
        internal.campaigns.getCampaignInternal,
        { campaignId: runDoc.campaignId },
      );
      autopilot = campaign?.autonomy === "autopilot";
      candidates = await ctx.runQuery(internal.emails.forCampaignInternal, {
        campaignId: runDoc.campaignId,
      });
    } else {
      candidates = await ctx.runQuery(internal.emails.allApproved, {});
    }

    const sendable = candidates.filter(
      (e) => e.status === "approved" || (autopilot && e.status === "draft"),
    );
    if (sendable.length === 0) return { sent: 0 };

    let sent = 0;
    for (const email of sendable) {
      const prospect: Doc<"prospects"> | null = await ctx.runQuery(
        internal.prospects.getInternal,
        { prospectId: email.prospectId },
      );
      const to = email.to || prospect?.email || undefined;

      const result = await sendMessage({
        to,
        subject: email.subject,
        text: email.body,
      });

      if (!result.sent) {
        await ctx.runMutation(internal.events.log, {
          runId,
          prospectId: email.prospectId,
          campaignId: runDoc.campaignId,
          agent: "sender",
          kind: "send_skipped",
          message: `Hold ${prospect?.company ?? "prospect"}: ${result.reason ?? "AgentMail not configured"}`,
        });
        continue;
      }

      await ctx.runMutation(internal.emails.setStatus, {
        emailId: email._id,
        status: "sent",
        to: result.to ?? to,
        sentAt: Date.now(),
        agentmailId: result.id,
        agentmailThreadId: result.threadId,
      });
      if (prospect && prospect.stage !== "replied" && prospect.stage !== "booked") {
        await ctx.runMutation(internal.prospects.update, {
          prospectId: email.prospectId,
          stage: "contacted",
        });
      }
      sent += 1;
      await ctx.runMutation(internal.events.log, {
        runId,
        prospectId: email.prospectId,
        campaignId: runDoc.campaignId,
        agent: "sender",
        kind: "sent",
        message: `Sent to ${result.to ?? to ?? prospect?.company ?? "recipient"} · "${email.subject}"`,
      });
    }

    if (sent > 0) {
      await ctx.runMutation(internal.runs.bumpCounters, {
        runId,
        contactedCount: sent,
      });
    }

    return { sent };
  },
});
