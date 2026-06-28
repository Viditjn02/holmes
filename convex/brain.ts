"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { brainAvailable, brainQuery, brainPut } from "../lib/gbrain";

// ============================================================================
// INTERCEPT — BRAIN CAPABILITY (gbrain, the compounding memory)
// ----------------------------------------------------------------------------
// gbrain is a LOCAL CLI on PATH (lib/gbrain.ts shells out to it). This module is
// the Convex-side executable behind the router's `intent:"brain"`:
//
//   • recall   — chat.ts answers "what did we learn about X" inline (NO run).
//   • remember — content/competitor agents write durable GTM findings back so
//                every run makes the next one smarter (the compounding loop).
//
// "use node" BECAUSE lib/gbrain uses node:child_process. It defines ONLY actions
// (no query/mutation) per the Convex rule. Every entry point degrades to a clean
// no-op when the CLI isn't resolvable in this runtime — it NEVER throws, so it
// can never block the chat or a swarm. (When Convex runs in the cloud the binary
// is absent and these return { available:false } / { ok:false }; on the local
// backend they hit the real brain.)
// ============================================================================

export interface BrainRecallResult {
  available: boolean;
  answer: string;
}

export interface BrainRememberResult {
  ok: boolean;
}

/**
 * Ask the brain what it already knows. Returns { available:false, answer:"" }
 * when the CLI is missing, the query failed, or there were no hits.
 */
export const recall = internalAction({
  args: { question: v.string() },
  handler: async (_ctx, { question }): Promise<BrainRecallResult> => {
    if (!brainAvailable()) return { available: false, answer: "" };
    try {
      const result = await brainQuery(question);
      return { available: result.available, answer: result.answer };
    } catch {
      return { available: false, answer: "" };
    }
  },
});

/**
 * Persist a durable finding back to the brain (markdown piped to `gbrain put`).
 * Best-effort: returns { ok:false } when the CLI is missing or the write failed.
 */
export const remember = internalAction({
  args: { slug: v.string(), markdown: v.string() },
  handler: async (_ctx, { slug, markdown }): Promise<BrainRememberResult> => {
    if (!brainAvailable()) return { ok: false };
    try {
      const ok = await brainPut(slug, markdown);
      return { ok };
    } catch {
      return { ok: false };
    }
  },
});
