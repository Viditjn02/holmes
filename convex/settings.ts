// ============================================================================
// INTERCEPT — WORKSPACE SETTINGS (the default business / target URL singleton)
// ----------------------------------------------------------------------------
// A persisted singleton (settings.key === "workspace") that holds the DEFAULT
// target URL every quick-action fires against and that any URL-less CommandBar
// command falls back to. Edited in two places — the dashboard target chip and
// the CommandSidebar settings gear — both reactive off `getSettings`.
//
// CONVEX RULES (deploy-safety, do NOT violate):
//   - This module is the DEFAULT runtime — NOT "use node" (query/mutation only).
//   - `Id`/`Doc` come from ./_generated/dataModel.
//   - PUBLIC + GRACEFUL: getSettings ALWAYS returns a value (seeds the default
//     when unset, never null); setTargetUrl normalizes/validates and never
//     throws for the caller — a blank/garbage input degrades to the default.
// ============================================================================

import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { DEFAULT_AD_ASPECT, type AdAspect } from "../lib/contract";

// The sensible out-of-the-box default when nothing has been persisted yet.
export const DEFAULT_TARGET_URL = "nolongerjobless.com";

// The singleton discriminator — there is exactly ONE settings row.
const WORKSPACE_KEY = "workspace" as const;

/** The shape every reader gets back. Always populated (never null). */
export interface WorkspaceSettings {
  targetUrl: string;
  targetLabel?: string;
  // 24/7 AUTONOMOUS master switch (DEFAULT OFF). Gates every keep-running
  // behavior: when false a track does its task ONCE and stops; when true the
  // recurring radar/sweep runs. Always present in the read (defaults to false).
  autonomous: boolean;
  // VIDEO AD ORIENTATION (DEFAULT "portrait"). The user toggle the Creative video
  // lane reads to thread the aspect to every provider. Always present in the read.
  videoAspect: AdAspect;
  updatedAt?: number;
}

// Out-of-the-box: autonomy is OFF — nothing loops until the user opts in.
export const DEFAULT_AUTONOMOUS = false;

// Out-of-the-box: portrait (9:16) — built for the feeds the buyers live in.
// Single source of truth is lib/contract.DEFAULT_AD_ASPECT; re-exported here so
// the settings reader has a local default to seed.
export const DEFAULT_VIDEO_ASPECT: AdAspect = DEFAULT_AD_ASPECT;

/**
 * Normalize an arbitrary URL or domain to a bare host:
 *   "https://www.Foo.com/bar?x=1"  →  "foo.com"
 *   "  EXAMPLE.IO  "               →  "example.io"
 * Mirrors lib/orangeslice.ts#normalizeDomain so the persisted value matches the
 * key shape used by the rest of the pipeline. Returns "" when nothing usable
 * remains so the caller can fall back to the default.
 */
function normalizeTargetUrl(input: string): string {
  let host = input.trim().toLowerCase();
  if (!host) return "";
  host = host.replace(/^https?:\/\//, "");
  host = host.replace(/^www\./, "");
  host = host.split("/")[0].split("?")[0].split("#")[0];
  return host.trim();
}

/** Read the persisted singleton (or null if it has never been written). */
async function readSingleton(ctx: QueryCtx): Promise<Doc<"settings"> | null> {
  return await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", WORKSPACE_KEY))
    .unique();
}

/**
 * getSettings — the reactive read for the dashboard chip + sidebar gear.
 * ALWAYS returns a value: seeds the default when the singleton is unset so the
 * UI never has to branch on null. Public; never throws.
 */
export const getSettings = query({
  args: {},
  handler: async (ctx): Promise<WorkspaceSettings> => {
    const row = await readSingleton(ctx);
    if (!row) {
      return {
        targetUrl: DEFAULT_TARGET_URL,
        autonomous: DEFAULT_AUTONOMOUS,
        videoAspect: DEFAULT_VIDEO_ASPECT,
      };
    }
    const targetUrl = row.targetUrl?.trim() || DEFAULT_TARGET_URL;
    return {
      targetUrl,
      targetLabel: row.targetLabel,
      autonomous: row.autonomous ?? DEFAULT_AUTONOMOUS,
      videoAspect: row.videoAspect ?? DEFAULT_VIDEO_ASPECT,
      updatedAt: row.updatedAt,
    };
  },
});

/**
 * setTargetUrl — normalize a URL/domain and upsert the workspace singleton.
 * A blank/garbage input degrades to the default rather than throwing, keeping
 * the contract "public, never throws". Returns the value that was persisted.
 */
export const setTargetUrl = mutation({
  args: {
    targetUrl: v.string(),
    targetLabel: v.optional(v.string()),
  },
  handler: async (ctx, { targetUrl, targetLabel }): Promise<WorkspaceSettings> => {
    const normalized = normalizeTargetUrl(targetUrl) || DEFAULT_TARGET_URL;
    const label = targetLabel?.trim() || undefined;
    const now = Date.now();

    const existing = await readSingleton(ctx);
    if (existing) {
      await ctx.db.patch(existing._id, {
        targetUrl: normalized,
        targetLabel: label,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("settings", {
        key: WORKSPACE_KEY,
        targetUrl: normalized,
        targetLabel: label,
        updatedAt: now,
      });
    }

    return {
      targetUrl: normalized,
      targetLabel: label,
      autonomous: existing?.autonomous ?? DEFAULT_AUTONOMOUS,
      videoAspect: existing?.videoAspect ?? DEFAULT_VIDEO_ASPECT,
      updatedAt: now,
    };
  },
});

/**
 * setAutonomous — flip the 24/7 master switch. When false (default) every
 * keep-running behavior is gated off: the cron tick no-ops, so a track does its
 * task once and stops. When true, the recurring radar/sweep runs. Upserts the
 * singleton, preserving the target. Public; never throws. Returns the new value.
 */
export const setAutonomous = mutation({
  args: { autonomous: v.boolean() },
  handler: async (ctx, { autonomous }): Promise<WorkspaceSettings> => {
    const now = Date.now();
    const existing = await readSingleton(ctx);
    if (existing) {
      await ctx.db.patch(existing._id, { autonomous, updatedAt: now });
      return {
        targetUrl: existing.targetUrl?.trim() || DEFAULT_TARGET_URL,
        targetLabel: existing.targetLabel,
        autonomous,
        videoAspect: existing.videoAspect ?? DEFAULT_VIDEO_ASPECT,
        updatedAt: now,
      };
    }
    // No singleton yet: seed it with the default target + the chosen flag.
    await ctx.db.insert("settings", {
      key: WORKSPACE_KEY,
      targetUrl: DEFAULT_TARGET_URL,
      autonomous,
      updatedAt: now,
    });
    return {
      targetUrl: DEFAULT_TARGET_URL,
      autonomous,
      videoAspect: DEFAULT_VIDEO_ASPECT,
      updatedAt: now,
    };
  },
});

/**
 * setVideoAspect — set the generated video ad's ORIENTATION (portrait 9:16 /
 * landscape 16:9). Upserts the workspace singleton, preserving the target +
 * autonomous flag. The Creative video lane reads this (settings.getSettings) and
 * threads it to every provider via lib/contract.aspectRatioFor. Mirrors the
 * setTargetUrl/setAutonomous pattern: public, never throws, returns the new value.
 */
export const setVideoAspect = mutation({
  args: {
    aspect: v.union(v.literal("portrait"), v.literal("landscape")),
  },
  handler: async (ctx, { aspect }): Promise<WorkspaceSettings> => {
    const now = Date.now();
    const existing = await readSingleton(ctx);
    if (existing) {
      await ctx.db.patch(existing._id, { videoAspect: aspect, updatedAt: now });
      return {
        targetUrl: existing.targetUrl?.trim() || DEFAULT_TARGET_URL,
        targetLabel: existing.targetLabel,
        autonomous: existing.autonomous ?? DEFAULT_AUTONOMOUS,
        videoAspect: aspect,
        updatedAt: now,
      };
    }
    // No singleton yet: seed it with the default target + the chosen orientation.
    await ctx.db.insert("settings", {
      key: WORKSPACE_KEY,
      targetUrl: DEFAULT_TARGET_URL,
      videoAspect: aspect,
      updatedAt: now,
    });
    return {
      targetUrl: DEFAULT_TARGET_URL,
      autonomous: DEFAULT_AUTONOMOUS,
      videoAspect: aspect,
      updatedAt: now,
    };
  },
});

/**
 * Internal read of the autonomous flag for the cron gate. Defaults to OFF when
 * the singleton is unset, so nothing loops until the user opts in.
 */
export const isAutonomous = internalQuery({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const row = await readSingleton(ctx);
    return row?.autonomous ?? DEFAULT_AUTONOMOUS;
  },
});
