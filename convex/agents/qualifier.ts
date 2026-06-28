// ============================================================================
// INTERCEPT — QUALIFIER AGENT
// ----------------------------------------------------------------------------
// Scores every enriched prospect 0-100 for ICP fit, then advances it to
// "qualified" (fitScore >= QUALIFY_THRESHOLD) or "skipped". One batched LLM call
// (with a deterministic heuristic fallback) so the run stays inside the fan-in
// deadline. NEVER throws — the orchestrator owns this agent's board tile.
// ============================================================================

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { QUALIFY_THRESHOLD } from "../../lib/contract";
import { chatJSON } from "../../lib/openai";

interface Score {
  fitScore: number;
  fitReason: string;
}

export const run = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<{ qualified: number }> => {
    const runDoc: Doc<"runs"> | null = await ctx.runQuery(
      internal.runs.getRunInternal,
      { runId },
    );
    if (!runDoc) throw new Error(`qualifier: run ${runId} not found`);

    const prospects: Doc<"prospects">[] = await ctx.runQuery(
      internal.prospects.forRunInternal,
      { runId },
    );
    if (prospects.length === 0) return { qualified: 0 };

    const context = await loadContext(ctx, runDoc);
    const scores = await scoreAll(prospects, context);

    let qualified = 0;
    for (const p of prospects) {
      const s = scores.get(p._id) ?? heuristic(p, context.icp);
      const isQualified = s.fitScore >= QUALIFY_THRESHOLD;
      if (isQualified) qualified += 1;
      await ctx.runMutation(internal.prospects.update, {
        prospectId: p._id,
        fitScore: s.fitScore,
        fitReason: s.fitReason,
        stage: isQualified ? "qualified" : "skipped",
        skipReason: isQualified ? undefined : "Below ICP fit threshold",
      });
      await ctx.runMutation(internal.events.log, {
        runId,
        prospectId: p._id,
        agent: "qualifier",
        kind: isQualified ? "qualified" : "skipped",
        message: `${isQualified ? "Qualified" : "Skipped"} ${p.company} · fit ${s.fitScore}/100 — ${s.fitReason}`,
      });
    }

    await ctx.runMutation(internal.runs.bumpCounters, {
      runId,
      qualifiedCount: qualified,
    });

    return { qualified };
  },
});

// ---------------------------------------------------------------------------
// Batched LLM scoring with a deterministic fallback.
// ---------------------------------------------------------------------------
async function scoreAll(
  prospects: Doc<"prospects">[],
  context: { icp: string; positioning: string; company: string },
): Promise<Map<string, Score>> {
  const out = new Map<string, Score>();
  try {
    const result = await chatJSON<{
      scores?: Array<{ id?: string; fitScore?: number; fitReason?: string }>;
    }>({
      system:
        "You are a B2B SDR lead-qualification analyst. Score each prospect 0-100 " +
        "for how well they fit the seller's Ideal Customer Profile, considering " +
        "company industry/size and the contact's seniority/role. Be calibrated " +
        "and decisive; give a one-line reason. Return STRICT JSON.",
      user: JSON.stringify({
        seller: context.company,
        positioning: context.positioning,
        idealCustomerProfile: context.icp,
        prospects: prospects.map((p) => ({
          id: p._id,
          company: p.company,
          industry: p.industry,
          employeeCount: p.employeeCount,
          title: p.title,
          location: p.location,
          signal: p.signal?.summary,
        })),
        instructions:
          'Return {"scores":[{"id":string,"fitScore":0-100 integer,"fitReason":string}]} — one per prospect, same id.',
      }),
      temperature: 0.2,
      maxTokens: 1500,
    });
    for (const s of result?.scores ?? []) {
      if (!s?.id) continue;
      out.set(s.id, {
        fitScore: clamp(s.fitScore),
        fitReason: s.fitReason?.trim() || "Scored on ICP fit.",
      });
    }
  } catch {
    // No key / failure — leave the map empty; caller uses the heuristic.
  }
  return out;
}

function clamp(n: unknown): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

/** Deterministic fallback: reward seniority + a present warm signal. */
function heuristic(p: Doc<"prospects">, icp: string): Score {
  let score = 50;
  const title = (p.title ?? "").toLowerCase();
  if (/founder|ceo|chief|vp|head|director/.test(title)) score += 18;
  else if (/manager|lead|principal/.test(title)) score += 8;
  if (p.signal) score += 12;
  if (p.emailVerified) score += 8;
  if (p.industry && icp.toLowerCase().includes(p.industry.toLowerCase().split(" ")[0]))
    score += 6;
  score = Math.max(0, Math.min(100, score));
  return {
    fitScore: score,
    fitReason: p.signal
      ? `${p.title ?? "Contact"} with a live ${p.signal.type} signal.`
      : `${p.title ?? "Contact"} at ${p.company}.`,
  };
}

async function loadContext(
  ctx: ActionCtx,
  runDoc: Doc<"runs">,
): Promise<{ icp: string; positioning: string; company: string }> {
  if (runDoc.campaignId) {
    const campaign: Doc<"campaigns"> | null = await ctx.runQuery(
      internal.campaigns.getCampaignInternal,
      { campaignId: runDoc.campaignId },
    );
    if (campaign) {
      return {
        icp: campaign.icp,
        positioning: campaign.positioning ?? "",
        company: campaign.company,
      };
    }
  }
  const brief = await ctx.runQuery(api.brief.getBrief, { runId: runDoc._id });
  return {
    icp: brief?.icp ?? "",
    positioning: brief?.positioning ?? "",
    company: runDoc.company ?? runDoc.input ?? "the company",
  };
}
