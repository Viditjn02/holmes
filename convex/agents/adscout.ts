// ============================================================================
// INTERCEPT — ADSCOUT AGENT  ·  AI Ad Factories
// ----------------------------------------------------------------------------
// Competitor-ad intelligence. Given a run, it reads the target company /
// competitor, searches the Meta Ad Library (lib/meta.searchAds) for that
// advertiser's live ads, and persists the longest-running ones into the frozen
// `ads` table. Ad longevity = proxy for a winning creative, so we rank by
// daysRunning desc ("running 47 days = working") and keep the top few.
//
// Self-contained: this file owns its own read query (getRun) and write mutation
// (save). It NEVER touches agentStatus (the orchestrator owns the board) and
// NEVER throws past its handler — a missing token or a restricted Ad Library
// response degrades to a clean no-op so the swarm and the brief never block.
//
// RUNTIME: intentionally NOT a "use node" file. Convex forbids defining queries
// and mutations in "use node" modules, and this agent needs both co-located.
// lib/meta.searchAds is a pure fetch client that runs in the default runtime.
// ============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { searchAds, type AdRow } from "../../lib/meta";

// How many ads to keep on the board. The winning angles cluster at the top once
// sorted by longevity, so a handful is plenty of signal.
const MAX_ADS = 8;

// ----------------------------------------------------------------------------
// READ: the run row (co-located, no cross-module dependency).
// ----------------------------------------------------------------------------
export const getRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"runs"> | null> => {
    return await ctx.db.get(runId);
  },
});

// ----------------------------------------------------------------------------
// WRITE: replace this run's ad rows with the freshly fetched, ranked set.
// Idempotent — clears prior rows so re-runs don't duplicate the board.
// ----------------------------------------------------------------------------
export const save = internalMutation({
  args: {
    runId: v.id("runs"),
    ads: v.array(
      v.object({
        advertiser: v.string(),
        platform: v.string(),
        text: v.string(),
        imageUrl: v.optional(v.string()),
        runningSince: v.optional(v.string()),
        daysRunning: v.optional(v.number()),
        status: v.string(),
        url: v.string(),
      }),
    ),
  },
  handler: async (ctx, { runId, ads }) => {
    const existing = await ctx.db
      .query("ads")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }
    for (const ad of ads) {
      await ctx.db.insert("ads", { runId, ...ad });
    }
    return ads.length;
  },
});

// ----------------------------------------------------------------------------
// Rank winning ads first: longest-running at the top, active ahead of inactive.
// ----------------------------------------------------------------------------
function rankAds(ads: AdRow[]): AdRow[] {
  return [...ads]
    .sort((a, b) => {
      // Active ads outrank ended ones at equal longevity.
      if (a.status !== b.status) {
        if (a.status === "active") return -1;
        if (b.status === "active") return 1;
      }
      return (b.daysRunning ?? 0) - (a.daysRunning ?? 0);
    })
    .slice(0, MAX_ADS);
}

// ----------------------------------------------------------------------------
// ACTION: fetch + rank + persist the competitor's live ads. Never blocks.
// ----------------------------------------------------------------------------
export const run = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const runDoc = await ctx.runQuery(internal.agents.adscout.getRun, { runId });
    if (!runDoc) return;

    // Replay mode: ads are pre-seeded from a fixture; do no external work.
    if (runDoc.replay) return;

    // The advertiser to look up: the resolved company, else the raw target.
    const advertiser = (runDoc.company ?? runDoc.input ?? "").trim();
    if (!advertiser) return;

    // Best-effort. lib/meta.searchAds already degrades to [] on any failure, but
    // we still guard so nothing escapes this handler.
    let ads: AdRow[] = [];
    try {
      ads = await searchAds(advertiser);
    } catch {
      ads = [];
    }

    if (ads.length === 0) {
      // Honest no-op for the board, but tell the live feed why nothing surfaced.
      await logEvent(
        ctx,
        runId,
        "competitor",
        `No live competitor ads surfaced for ${advertiser} (Meta Ad Library commercial search is region/identity restricted).`,
      );
      return;
    }

    const ranked = rankAds(ads);
    await ctx.runMutation(internal.agents.adscout.save, {
      runId,
      ads: ranked,
    });

    const topDays = ranked[0]?.daysRunning;
    await logEvent(
      ctx,
      runId,
      "competitor",
      `Found ${ranked.length} live ads for ${advertiser}, ranked by longevity${
        topDays !== undefined ? ` (top: running ${topDays} days)` : ""
      }.`,
    );

    // Compounding: ad longevity = a proven winning angle. Persist the top
    // angles to the brain so future runs can mirror what already converts.
    await rememberAngles(ctx, advertiser, ranked);
  },
});

// ----------------------------------------------------------------------------
// Live-feed + compounding helpers. Best-effort — never block the adscout lane.
// ----------------------------------------------------------------------------
async function logEvent(
  ctx: ActionCtx,
  runId: Id<"runs">,
  kind: string,
  message: string,
): Promise<void> {
  try {
    await ctx.runMutation(internal.events.log, {
      runId,
      agent: "adscout",
      kind,
      message,
    });
  } catch {
    // ignore — the feed is additive
  }
}

async function rememberAngles(
  ctx: ActionCtx,
  advertiser: string,
  ads: AdRow[],
): Promise<void> {
  const winners = ads
    .filter((a) => a.status === "active" && (a.daysRunning ?? 0) >= 7 && a.text.trim())
    .slice(0, 5);
  if (winners.length === 0) return;

  const slug = `intercept-competitor-${slugify(advertiser)}`;
  const markdown = [
    `# ${advertiser} — winning ad angles (Meta Ad Library, via INTERCEPT)`,
    "",
    "Ranked by run-duration (longer = a more proven angle):",
    "",
    ...winners.map(
      (a) =>
        `- (${a.daysRunning ?? "?"}d) ${a.text.replace(/\s+/g, " ").trim().slice(0, 220)}`,
    ),
  ].join("\n");

  try {
    await ctx.runAction(internal.brain.remember, { slug, markdown });
  } catch {
    // brain unavailable in this runtime — degrade silently
  }
}

/** Lowercase, hyphenated, filesystem-safe slug for a brain page key. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "competitor"
  );
}
