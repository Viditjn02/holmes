// ============================================================================
// INTERCEPT — FOLLOWER AGENT  (reply-aware follow-up cadence)
// ----------------------------------------------------------------------------
// Walks the campaign's/run's sent emails. For any prospect who hasn't replied
// and whose next cadence step (SEQUENCE_DELAYS_DAYS) is due, drafts the next
// follow-up as a "draft" email (it re-enters the same human-approval gate; the
// sender ships it on the next outreach pass). Prospects who DID reply are
// advanced to the "replied" stage. NEVER throws — the orchestrator owns the tile.
// ============================================================================

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  SEQUENCE_DELAYS_DAYS,
  MAX_SEQUENCE_STEPS,
} from "../../lib/contract";
import { chatJSON } from "../../lib/openai";

const MS_PER_DAY = 86_400_000;

export const run = internalAction({
  args: { runId: v.id("runs") },
  handler: async (
    ctx,
    { runId },
  ): Promise<{ followups: number; replies: number }> => {
    const runDoc: Doc<"runs"> | null = await ctx.runQuery(
      internal.runs.getRunInternal,
      { runId },
    );
    if (!runDoc) throw new Error(`follower: run ${runId} not found`);

    const emails: Doc<"emails">[] = runDoc.campaignId
      ? await ctx.runQuery(internal.emails.forCampaignInternal, {
          campaignId: runDoc.campaignId,
        })
      : await ctx.runQuery(internal.emails.forRunInternal, { runId });

    // Group every email by prospect.
    const byProspect = new Map<Id<"prospects">, Doc<"emails">[]>();
    for (const e of emails) {
      const arr = byProspect.get(e.prospectId) ?? [];
      arr.push(e);
      byProspect.set(e.prospectId, arr);
    }

    let followups = 0;
    let replies = 0;

    for (const [prospectId, thread] of byProspect) {
      // Reply detection: a replied email advances the prospect.
      if (thread.some((e) => e.status === "replied")) {
        const prospect: Doc<"prospects"> | null = await ctx.runQuery(
          internal.prospects.getInternal,
          { prospectId },
        );
        if (prospect && prospect.stage !== "booked" && prospect.stage !== "replied") {
          await ctx.runMutation(internal.prospects.update, {
            prospectId,
            stage: "replied",
          });
          replies += 1;
          await ctx.runMutation(internal.events.log, {
            runId,
            prospectId,
            campaignId: runDoc.campaignId,
            agent: "follower",
            kind: "replied",
            message: `${prospect.company} replied — moved to Replied.`,
          });
        }
        continue; // never chase someone who already replied
      }

      const sent = thread
        .filter((e) => e.status === "sent" && e.sentAt)
        .sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0));
      if (sent.length === 0) continue;

      const firstSentAt = sent[0].sentAt ?? Date.now();
      const maxStep = Math.max(...thread.map((e) => e.step));
      const nextStep = maxStep + 1;
      if (nextStep >= MAX_SEQUENCE_STEPS) continue;

      const dueAt = firstSentAt + SEQUENCE_DELAYS_DAYS[nextStep] * MS_PER_DAY;
      if (Date.now() < dueAt) continue; // not due yet
      // Don't double-draft a follow-up that already exists at this step.
      if (thread.some((e) => e.step === nextStep)) continue;

      const prospect: Doc<"prospects"> | null = await ctx.runQuery(
        internal.prospects.getInternal,
        { prospectId },
      );
      if (!prospect) continue;

      const draft = await writeFollowup(prospect, sent[0], nextStep);
      await ctx.runMutation(internal.emails.insert, {
        prospectId,
        campaignId: runDoc.campaignId,
        runId,
        step: nextStep,
        kind: "followup",
        subject: draft.subject,
        body: draft.body,
        signalRef: prospect.signal?.summary,
        to: prospect.email,
      });
      followups += 1;
      await ctx.runMutation(internal.events.log, {
        runId,
        prospectId,
        campaignId: runDoc.campaignId,
        agent: "follower",
        kind: "followup",
        message: `Drafted follow-up #${nextStep} for ${prospect.company}`,
      });
    }

    return { followups, replies };
  },
});

interface DraftOut {
  subject: string;
  body: string;
}

async function writeFollowup(
  prospect: Doc<"prospects">,
  initial: Doc<"emails">,
  step: number,
): Promise<DraftOut> {
  const first = (prospect.name ?? "there").split(" ")[0];
  try {
    const result = await chatJSON<DraftOut>({
      system:
        "You write a SHORT, polite B2B follow-up to a cold email that got no reply. " +
        "Under 60 words, reference the original thread lightly, add one new angle or " +
        "a one-line nudge, end with an easy yes/no question. No guilt-tripping. STRICT JSON.",
      user: [
        `PROSPECT: ${prospect.name ?? prospect.company}, ${prospect.title ?? ""} at ${prospect.company}`,
        `ORIGINAL SUBJECT: ${initial.subject}`,
        `ORIGINAL BODY: ${initial.body}`,
        `This is follow-up #${step}.`,
        'Return {"subject": string, "body": string}. Subject should be "Re: <original>".',
      ].join("\n"),
      temperature: 0.6,
      maxTokens: 240,
    });
    if (result?.subject?.trim() && result?.body?.trim()) {
      return { subject: result.subject.trim().slice(0, 120), body: result.body.trim() };
    }
  } catch {
    // fall through
  }
  return {
    subject: `Re: ${initial.subject}`,
    body: [
      `Hi ${first},`,
      "",
      `Floating this back up in case it slipped by. Still happy to share how this could help ${prospect.company} — worth a quick chat?`,
    ].join("\n"),
  };
}
