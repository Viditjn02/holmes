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
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// The sensible out-of-the-box default when nothing has been persisted yet.
export const DEFAULT_TARGET_URL = "nolongerjobless.com";

// The singleton discriminator — there is exactly ONE settings row.
const WORKSPACE_KEY = "workspace" as const;

/** The shape every reader gets back. Always populated (never null). */
export interface WorkspaceSettings {
  targetUrl: string;
  targetLabel?: string;
  updatedAt?: number;
}

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
      return { targetUrl: DEFAULT_TARGET_URL };
    }
    const targetUrl = row.targetUrl?.trim() || DEFAULT_TARGET_URL;
    return {
      targetUrl,
      targetLabel: row.targetLabel,
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

    return { targetUrl: normalized, targetLabel: label, updatedAt: now };
  },
});
