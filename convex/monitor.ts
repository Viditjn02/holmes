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

// ============================================================================
// INTERCEPT — MONITORS (the 24/7 watch).
//
// A monitor is a standing instruction: "keep watching this company". The cron
// (convex/crons.ts) fires internal.monitor.tick on an interval; tick re-runs
// the full swarm for any active monitor whose cadence has elapsed by spawning a
// normal run (api.runs.createRun). Found drafts still flow through the human
// approval queue — autonomous discovery, human-approved outreach.
//
// Self-contained: this module owns its own table + persistence. It defines
// queries/mutations so it must NOT be "use node". Every internalAction handler
// has an explicit return type and every same-module ctx.runQuery/runMutation
// result is explicitly typed (Convex circular inference -> deploy fails
// otherwise).
//
// Wiring: api.runs.createRun accepts optional { monitorId, skipVideo }; the
// orchestrator (convex/run.ts) skips the creative/Veo agent when skipVideo is
// set, so background ticks never burn Veo credits. tick passes `skipVideo: true`
// + `monitorId: monitor._id` at the call site below.
// ============================================================================

// Mirrors schema runs.inputType / monitors.inputType. Validated at the boundary.
const inputTypeValidator = v.union(
  v.literal("url"),
  v.literal("name"),
  v.literal("competitor"),
  v.literal("community"),
  v.literal("text"),
);

const DEFAULT_CADENCE_MINUTES = 60;
const MIN_CADENCE_MINUTES = 15;
const MS_PER_MINUTE = 60_000;

/** Clamp a requested cadence to a sane floor; default when unset/invalid. */
function normalizeCadence(cadenceMinutes: number | undefined): number {
  if (cadenceMinutes === undefined || !Number.isFinite(cadenceMinutes)) {
    return DEFAULT_CADENCE_MINUTES;
  }
  return Math.max(MIN_CADENCE_MINUTES, Math.round(cadenceMinutes));
}

// ---------------------------------------------------------------------------
// PUBLIC: create / list / toggle / delete monitors.
// ---------------------------------------------------------------------------

/** Start watching a company 24/7. Inserts an active monitor. */
export const createMonitor = mutation({
  args: {
    company: v.string(),
    input: v.string(),
    inputType: inputTypeValidator,
    cadenceMinutes: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { company, input, inputType, cadenceMinutes },
  ): Promise<Id<"monitors">> => {
    const trimmedInput = input.trim();
    if (trimmedInput.length === 0) {
      throw new Error("createMonitor: input must not be empty");
    }
    const trimmedCompany = company.trim();

    return await ctx.db.insert("monitors", {
      company: trimmedCompany.length > 0 ? trimmedCompany : trimmedInput,
      input: trimmedInput,
      inputType,
      active: true,
      cadenceMinutes: normalizeCadence(cadenceMinutes),
      createdAt: Date.now(),
    });
  },
});

/** All monitors, active first then newest — drives the panel list (reactive). */
export const listMonitors = query({
  args: {},
  handler: async (ctx): Promise<Doc<"monitors">[]> => {
    const monitors = await ctx.db.query("monitors").collect();
    return monitors.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  },
});

/** Pause / resume a monitor. Paused monitors are skipped by the cron tick. */
export const toggleMonitor = mutation({
  args: { monitorId: v.id("monitors"), active: v.boolean() },
  handler: async (ctx, { monitorId, active }): Promise<void> => {
    const monitor = await ctx.db.get(monitorId);
    if (!monitor) return;
    await ctx.db.patch(monitorId, { active });
  },
});

/** Permanently stop watching — removes the monitor (existing runs are kept). */
export const deleteMonitor = mutation({
  args: { monitorId: v.id("monitors") },
  handler: async (ctx, { monitorId }): Promise<void> => {
    const monitor = await ctx.db.get(monitorId);
    if (!monitor) return;
    await ctx.db.delete(monitorId);
  },
});

// ---------------------------------------------------------------------------
// INTERNAL: the autonomous loop. Only the cron + tick call these.
// ---------------------------------------------------------------------------

/** Active monitors only (cron reads this from the action runtime). */
export const activeMonitors = internalQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"monitors">[]> => {
    return await ctx.db
      .query("monitors")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
  },
});

/** Stamp a monitor's last tick. Best-effort: no-op if it was deleted mid-run. */
export const markTicked = internalMutation({
  args: { monitorId: v.id("monitors"), runId: v.id("runs") },
  handler: async (ctx, { monitorId, runId }): Promise<void> => {
    const monitor = await ctx.db.get(monitorId);
    if (!monitor) return;
    await ctx.db.patch(monitorId, { lastRunAt: Date.now(), lastRunId: runId });
  },
});

/**
 * The 24/7 tick. Called by the cron. For each active monitor whose cadence has
 * elapsed (or that has never run), spawn a fresh swarm run and stamp the
 * monitor. Per-monitor failures are swallowed so one bad monitor can never
 * abort the whole loop.
 */
export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ticked: number }> => {
    // Explicitly typed — same-module runQuery (circular inference guard).
    const monitors: Doc<"monitors">[] = await ctx.runQuery(
      internal.monitor.activeMonitors,
      {},
    );

    const now = Date.now();
    let ticked = 0;

    for (const monitor of monitors) {
      const dueAt =
        monitor.lastRunAt == null
          ? 0
          : monitor.lastRunAt + monitor.cadenceMinutes * MS_PER_MINUTE;
      if (now < dueAt) continue;

      try {
        // Spawn a normal run, tagged to this monitor and with skipVideo set so
        // the background swarm skips the Veo/creative lane (no burned credits).
        const runId: Id<"runs"> = await ctx.runMutation(api.runs.createRun, {
          input: monitor.input,
          inputType: monitor.inputType,
          monitorId: monitor._id,
          skipVideo: true,
        });

        // Explicitly typed (void) — same-module runMutation.
        await ctx.runMutation(internal.monitor.markTicked, {
          monitorId: monitor._id,
          runId,
        });
        ticked += 1;
      } catch {
        // Swallow: a single monitor's failure must not abort the loop. The
        // monitor isn't stamped, so it's simply retried on the next tick.
      }
    }

    return { ticked };
  },
});
