import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// ============================================================================
// INTERCEPT — CRONS (the 24/7 autonomous loop).
//
// ONE interval job. Every 60 minutes it calls internal.monitor.tick, which
// walks the active monitors and re-runs the swarm for any whose cadence has
// elapsed. Each tick spawns a normal run via api.runs.createRun, so every newly
// discovered buyer still lands in the human approval queue — autonomous
// discovery, human-approved outreach.
//
// The interval is intentionally coarse (60m). Per-monitor cadence
// (monitors.cadenceMinutes) is enforced inside tick, so a monitor can be slower
// than the cron but never faster than it.
// ============================================================================

const crons = cronJobs();

crons.interval(
  "intercept monitor tick",
  { minutes: 60 },
  internal.monitor.tick,
  {},
);

export default crons;
