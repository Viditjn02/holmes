import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// ============================================================================
// INTERCEPT — CRONS (the 24/7 autonomous loop).
//
// ONE interval job. Every 30 minutes it calls internal.campaigns.tick, which
// walks the ACTIVE campaigns and, for any whose cadence has elapsed, spawns a
// fresh outbound run (re-source + qualify + draft) AND an outreach run (ship
// already-approved emails + write due follow-ups). Drafts still land in the
// human-approval queue unless the campaign is on autopilot — autonomous
// discovery, human-gated send.
//
// The interval is intentionally coarse (30m). Per-campaign cadence
// (campaigns.cadenceMinutes) is enforced inside tick, so a campaign can be slower
// than the cron but never faster than it.
// ============================================================================

const crons = cronJobs();

crons.interval(
  "intercept campaign tick",
  { minutes: 30 },
  internal.campaigns.tick,
  {},
);

export default crons;
