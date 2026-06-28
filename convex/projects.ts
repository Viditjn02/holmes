import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// ============================================================================
// INTERCEPT — PROJECTS (GitHub artifact intelligence, read side)
//
// Populated by the scout agent (convex/agents/scout.ts). components/
// ProjectGallery.tsx reads this reactively. Rows arrive sorted, but we re-sort
// here (populated-first → confidence → stars) so the read is self-consistent
// regardless of insert order.
// ============================================================================

/** Read all of a run's scouted projects, populated + high-confidence first. */
export const listByRun = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"projects">[]> => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();

    return projects.sort((a, b) => {
      // Populated repos ahead of empty/placeholder ones.
      const emptyA = a.isEmpty ? 1 : 0;
      const emptyB = b.isEmpty ? 1 : 0;
      if (emptyA !== emptyB) return emptyA - emptyB;
      // Then by analysis confidence.
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      // Then by stars.
      return (b.stars ?? 0) - (a.stars ?? 0);
    });
  },
});
