import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { AGENTS, FANIN_DEADLINE_MS } from "../lib/contract";

// ============================================================================
// HOLMES — runs core. Owns the lifecycle of a single GTM run and the
// agentStatus rows that drive the live swarm board. The orchestrator
// (convex/run.ts) reacts to this and owns the deadline fan-in.
// ============================================================================

// Mirrors schema runs.inputType. Kept here so the public mutation validates at
// the boundary before anything is persisted.
const inputTypeValidator = v.union(
  v.literal("url"),
  v.literal("name"),
  v.literal("competitor"),
  v.literal("community"),
  v.literal("text"),
);

const runStatusValidator = v.union(
  v.literal("running"),
  v.literal("complete"),
  v.literal("partial"),
  v.literal("failed"),
);

const agentStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("done"),
  v.literal("skipped"),
  v.literal("failed"),
);

/**
 * Kick off a run. Inserts the run (status "running"), one "queued" agentStatus
 * row per swarm agent, then schedules the orchestrator. The deadline is hard:
 * the brief + board render from whatever exists at `deadlineAt` regardless.
 */
export const createRun = mutation({
  args: {
    input: v.string(),
    inputType: inputTypeValidator,
    replay: v.optional(v.boolean()),
  },
  handler: async (ctx, { input, inputType, replay }) => {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      throw new Error("createRun: input must not be empty");
    }

    const now = Date.now();
    const runId = await ctx.db.insert("runs", {
      input: trimmed,
      inputType,
      status: "running",
      startedAt: now,
      deadlineAt: now + FANIN_DEADLINE_MS,
      replay: replay ?? false,
    });

    // One board row per agent, queued. The orchestrator flips these.
    for (const agent of AGENTS) {
      await ctx.db.insert("agentStatus", {
        runId,
        agent,
        status: "queued",
      });
    }

    // Hand off to the orchestrator. It owns agentStatus + the fan-in deadline.
    await ctx.scheduler.runAfter(0, internal.run.orchestrate, { runId });

    return runId;
  },
});

/** Read a single run (reactive, used by the run page header + status pill). */
export const getRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await ctx.db.get(runId);
  },
});

/** All runs, newest first (recent-runs list / demo history). */
export const listRuns = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("runs").order("desc").take(50);
  },
});

// ---------------------------------------------------------------------------
// Internal helpers — only the orchestrator calls these.
// ---------------------------------------------------------------------------

/** Internal read of a run (the orchestrator action needs deadlineAt). */
export const getRunInternal = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await ctx.db.get(runId);
  },
});

/** Patch a single agent's board row, stamping start/finish times by status. */
export const setAgentStatus = internalMutation({
  args: {
    runId: v.id("runs"),
    agent: v.string(),
    status: agentStatusValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, { runId, agent, status, note }) => {
    const row = await ctx.db
      .query("agentStatus")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .filter((q) => q.eq(q.field("agent"), agent))
      .unique();

    if (!row) return;

    const now = Date.now();
    const patch: {
      status: typeof status;
      note?: string;
      startedAt?: number;
      finishedAt?: number;
    } = { status };

    if (note !== undefined) patch.note = note;
    if (status === "running") patch.startedAt = now;
    if (status === "done" || status === "failed" || status === "skipped") {
      patch.finishedAt = now;
    }

    await ctx.db.patch(row._id, patch);
  },
});

/** Flip the run's terminal status. */
export const completeRun = internalMutation({
  args: {
    runId: v.id("runs"),
    status: runStatusValidator,
  },
  handler: async (ctx, { runId, status }) => {
    await ctx.db.patch(runId, { status });
  },
});
