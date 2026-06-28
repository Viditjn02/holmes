import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AGENTS } from "../lib/contract";
import { upsertBrief } from "./brief";

// ============================================================================
// HOLMES — THE ORCHESTRATOR.
//
// Owns the live swarm board (agentStatus) and the hard fan-in deadline. The
// P1 finding: the brief + board MUST render regardless of slow/failed agents.
// So we schedule `finalize` at runs.deadlineAt as a guaranteed cap, AND call
// it early once the swarm settles. Whichever fires first wins; finalize is
// idempotent (it no-ops once the run leaves "running").
//
// Agents persist their OWN results. The orchestrator only drives status +
// the deadline. It never touches communities/threads/drafts/creatives.
// ============================================================================

// The five board agents (per the frozen contract). `reply` runs in the swarm
// too but is NOT a board row — it silently drafts in-thread replies off the
// threads the detective found.
const BOARD_AGENTS: ReadonlySet<string> = new Set<string>(AGENTS);

// Execution plan. Cheap classification + enrichment first, then the detective
// (the moat — needs enrich context), then the three independent consumers in
// parallel. `reply` reads threads; `creative` builds the Veo ad; `watcher`
// monitors. Promise.allSettled means one straggler never blocks the others.
const PHASES: ReadonlyArray<ReadonlyArray<string>> = [
  ["router", "enrich"],
  ["detective"],
  ["reply", "creative", "watcher"],
];

/**
 * Resolve a swarm agent's `run` action reference by name. Agents live in
 * separate worktrees and are wired in at merge; the dynamic lookup keeps this
 * module compiling and lets us fail gracefully if one isn't registered.
 */
function agentRunRef(name: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agents = (internal as any).agents;
  return agents?.[name]?.run;
}

/**
 * Run one agent with full isolation. Board agents get running -> done/failed
 * status transitions; non-board agents (reply) just run. Nothing thrown here
 * ever escapes — a single agent's failure must not abort the swarm.
 */
async function runAgent(
  ctx: ActionCtx,
  runId: Id<"runs">,
  name: string,
): Promise<void> {
  const isBoard = BOARD_AGENTS.has(name);

  if (isBoard) {
    await ctx.runMutation(internal.runs.setAgentStatus, {
      runId,
      agent: name,
      status: "running",
    });
  }

  try {
    const ref = agentRunRef(name);
    if (!ref) {
      throw new Error(`agent "${name}" is not registered`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.runAction(ref as any, { runId });

    if (isBoard) {
      await ctx.runMutation(internal.runs.setAgentStatus, {
        runId,
        agent: name,
        status: "done",
      });
    }
  } catch (error: unknown) {
    const note = error instanceof Error ? error.message : String(error);
    if (isBoard) {
      await ctx.runMutation(internal.runs.setAgentStatus, {
        runId,
        agent: name,
        status: "failed",
        note: note.slice(0, 500),
      });
    }
  }
}

/**
 * Drive the full swarm for a run. Schedules the deadline finalize up front (the
 * guarantee), runs the phases, then finalizes early. Even if this action dies
 * mid-flight, the scheduled finalize still completes the run.
 */
export const orchestrate = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.runQuery(internal.runs.getRunInternal, { runId });
    if (!run) return;

    // Guaranteed cap: render from whatever exists at the deadline, no matter
    // what happens below.
    await ctx.scheduler.runAt(run.deadlineAt, internal.run.finalize, { runId });

    try {
      for (const phase of PHASES) {
        await Promise.allSettled(
          phase.map((name) => runAgent(ctx, runId, name)),
        );
      }
    } finally {
      // Early finalize: the swarm has settled, so don't make the demo wait out
      // the deadline. Idempotent — the scheduled finalize will no-op.
      await ctx.runMutation(internal.run.finalize, { runId });
    }
  },
});

/**
 * Fan-in. Idempotent and deadline-safe. Marks any agent still in flight as
 * "skipped", repairs/guarantees the brief, and flips the run to its terminal
 * status: complete (all board agents done), partial (some done), or failed
 * (none done). Runs as a mutation so the whole assembly is atomic.
 */
export const finalize = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;

    // Already finalized (early finish or a prior deadline fire) — do nothing.
    if (run.status !== "running") return;

    const rows = await ctx.db
      .query("agentStatus")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();

    // Anything not yet terminal at fan-in time is a casualty of the deadline.
    const now = Date.now();
    for (const row of rows) {
      if (row.status === "queued" || row.status === "running") {
        await ctx.db.patch(row._id, {
          status: "skipped",
          finishedAt: now,
          note: row.note ?? "skipped at fan-in deadline",
        });
      }
    }

    // Guarantee a brief exists so the board renders no matter what.
    await upsertBrief(ctx, { runId });

    const settled = rows.map((row) =>
      row.status === "queued" || row.status === "running"
        ? "skipped"
        : row.status,
    );
    const total = settled.length;
    const doneCount = settled.filter((s) => s === "done").length;

    const status: "complete" | "partial" | "failed" =
      total > 0 && doneCount === total
        ? "complete"
        : doneCount > 0
          ? "partial"
          : "failed";

    await ctx.db.patch(runId, { status });
  },
});
