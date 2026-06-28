"use client";

/**
 * useBlipReactions — maps INTERCEPT's LIVE Convex state onto the blip's mood
 * and a fun, ambient one-liner speech bubble. The blip is pure delight that
 * reacts to the swarm working beside you; it NEVER takes input.
 *
 * Reaction model (priority high → low):
 *   1. a one-shot beat is active (celebrate / concerned / peek / nod)  → show it
 *   2. any run is currently "running"                                  → thinking
 *   3. otherwise                                                       → idle
 *
 * What fires a one-shot:
 *   celebrate (a WIN, one-shot → back to idle):
 *     • a run flips running → complete | partial           (api.runs.listRuns)
 *     • an email flips → "replied"                          (api.emails.byRun)
 *     • a hot lead: a thread with intentScore ≥ 80 appears  (api.brief.getThreads)
 *     • a post scores high: viralityScore ≥ 80 appears      (api.agents.composer.postsForRun)
 *     • an ad is generated: a new adCreative appears        (api.agents.adsmith.creativesForRun)
 *   concerned (soft worry, one-shot):
 *     • a run flips → "failed"                              (api.runs.listRuns)
 *   peek / nod (tiny ambient beats off the event feed, if a conversationId is given):
 *     • "found" / "sourced" / "qualified" → peek + a one-liner ("found a hot lead 👀")
 *     • "sent"                            → nod  + a one-liner ("sending…")
 *
 * GLOBAL by default: with NO ids it subscribes only to `api.runs.listRuns`
 * (the all-deployment run feed) — enough for thinking / celebrate / concerned.
 * Pass the focused `runId` and/or `conversationId` for the richer per-run wins
 * and the event-feed one-liners.
 *
 * Defensive: every query is real (verified against the repo) but each detector
 * PRIMES on its first non-empty result, so mounting on a deployment that already
 * has completed runs / replies does NOT trigger a celebrate storm — only changes
 * AFTER mount fire. Missing ids → that query is "skip"ped and simply contributes
 * nothing. Nothing here can throw or block.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { BlipState } from "./Blip";

/** One-shot beats auto-return to the resolved base (idle/thinking) after this
 *  long, so the beat reads, then resolves. */
const ONE_SHOT_MS = 2200;
/** A fun one-liner lingers a touch longer than the pose, then auto-dismisses. */
const SPEECH_MS = 4600;
/** "Hot lead" / "winning post" thresholds (schema: intentScore + viralityScore 0–100). */
const HOT_INTENT = 80;
const HOT_VIRALITY = 80;

// Minimal row shapes (kept local so this file doesn't couple to the full Doc<>
// types; the real queries return supersets of these).
interface RunRow { _id: string; status: string }
interface ThreadRow { _id: string; intentScore?: number }
interface EmailRow { _id: string; status: string }
interface PostRow { _id: string; viralityScore?: number }
interface CreativeRow { _id: string }
interface EventRow { _id: string; kind: string; message: string; createdAt: number }

export interface BlipReaction {
  /** The mood to feed into <Blip state={...} />. */
  state: BlipState;
  /** A fun ambient one-liner for an OPTIONAL speech bubble, or null. Never an input. */
  speech: string | null;
  /** Dismiss the current speech bubble early (e.g. on click). */
  dismissSpeech: () => void;
  /** True while at least one run is running (handy for an aria-label / tooltip). */
  busy: boolean;
}

interface UseBlipReactionsOptions {
  /** The focused run — enables per-run win signals (threads/emails/posts/ads). */
  runId?: Id<"runs"> | null;
  /** The active conversation — enables the event-feed ambient one-liners. */
  conversationId?: Id<"conversations"> | null;
  /** Master switch (default true). When false, the blip just idles. */
  enabled?: boolean;
}

export function useBlipReactions(
  options: UseBlipReactionsOptions = {},
): BlipReaction {
  const { runId = null, conversationId = null, enabled = true } = options;

  // ----- live subscriptions (all reactive; "skip" when an id is absent) -----
  const runs = useQuery(api.runs.listRuns, enabled ? {} : "skip") as
    | RunRow[]
    | undefined;
  const threads = useQuery(
    api.brief.getThreads,
    enabled && runId ? { runId } : "skip",
  ) as ThreadRow[] | undefined;
  const emails = useQuery(
    api.emails.byRun,
    enabled && runId ? { runId } : "skip",
  ) as EmailRow[] | undefined;
  const posts = useQuery(
    api.agents.composer.postsForRun,
    enabled && runId ? { runId } : "skip",
  ) as PostRow[] | undefined;
  const creatives = useQuery(
    api.agents.adsmith.creativesForRun,
    enabled && runId ? { runId } : "skip",
  ) as CreativeRow[] | undefined;
  const feed = useQuery(
    api.events.feedForConversation,
    enabled && conversationId ? { conversationId } : "skip",
  ) as EventRow[] | undefined;

  // ----- one-shot + speech beat (latest beat wins; auto-resolves) -----
  const [oneShot, setOneShot] = useState<BlipState | null>(null);
  const [speech, setSpeech] = useState<string | null>(null);
  const oneShotTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((state: BlipState, line?: string | null) => {
    setOneShot(state);
    if (oneShotTimer.current) clearTimeout(oneShotTimer.current);
    oneShotTimer.current = setTimeout(() => setOneShot(null), ONE_SHOT_MS);
    if (line) {
      setSpeech(line);
      if (speechTimer.current) clearTimeout(speechTimer.current);
      speechTimer.current = setTimeout(() => setSpeech(null), SPEECH_MS);
    }
  }, []);

  const dismissSpeech = useCallback(() => {
    if (speechTimer.current) clearTimeout(speechTimer.current);
    setSpeech(null);
  }, []);

  useEffect(
    () => () => {
      if (oneShotTimer.current) clearTimeout(oneShotTimer.current);
      if (speechTimer.current) clearTimeout(speechTimer.current);
    },
    [],
  );

  // ----- detectors. Each PRIMES on first load (snapshot, no fire) then reacts
  // only to changes AFTER mount. All immutable; refs hold the prior snapshot. -----

  // Runs: running → complete|partial = WIN; → failed = CONCERNED.
  const runStatus = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!runs) return;
    const next = new Map(runs.map((r) => [r._id, r.status]));
    const prev = runStatus.current;
    runStatus.current = next;
    if (!prev) return; // prime
    for (const [id, status] of next) {
      const was = prev.get(id);
      if (was === status) continue;
      if ((status === "complete" || status === "partial") && was === "running") {
        fire("celebrate", "done — take a look 👀");
      } else if (status === "failed" && was !== "failed") {
        fire("concerned", "hmm, that one stalled");
      }
    }
  }, [runs, fire]);

  // Threads: a NEW thread with intentScore ≥ 80 is a hot lead.
  const seenThreads = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!threads) return;
    const prev = seenThreads.current;
    seenThreads.current = new Set(threads.map((t) => t._id));
    if (!prev) return; // prime
    const hotNew = threads.some(
      (t) => !prev.has(t._id) && (t.intentScore ?? 0) >= HOT_INTENT,
    );
    if (hotNew) fire("celebrate", "found a hot lead 👀");
  }, [threads, fire]);

  // Emails: a transition into "replied" is a win.
  const emailStatus = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!emails) return;
    const next = new Map(emails.map((e) => [e._id, e.status]));
    const prev = emailStatus.current;
    emailStatus.current = next;
    if (!prev) return; // prime
    for (const [id, status] of next) {
      if (status === "replied" && prev.get(id) !== "replied") {
        fire("celebrate", "got a reply 🎉");
        break;
      }
    }
  }, [emails, fire]);

  // Posts: a NEW post scoring ≥ 80 virality is a banger.
  const seenPosts = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!posts) return;
    const prev = seenPosts.current;
    seenPosts.current = new Set(posts.map((p) => p._id));
    if (!prev) return; // prime
    const bangerNew = posts.some(
      (p) => !prev.has(p._id) && (p.viralityScore ?? 0) >= HOT_VIRALITY,
    );
    if (bangerNew) fire("celebrate", "that post's a banger 🔥");
  }, [posts, fire]);

  // Ad factory: a NEW generated creative is a win.
  const seenCreatives = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!creatives) return;
    const prev = seenCreatives.current;
    seenCreatives.current = new Set(creatives.map((c) => c._id));
    if (!prev) return; // prime
    const fresh = creatives.some((c) => !prev.has(c._id));
    if (fresh) fire("celebrate", "that ad's a winner!");
  }, [creatives, fire]);

  // Event feed: small ambient beats + one-liners (peek/nod). Reacts to the
  // newest event id only, and only to NEW ones after priming. Replies are
  // already celebrated above; here we cover the lighter "in-progress" beats.
  const lastEventId = useRef<string | null>(null);
  const primedFeed = useRef(false);
  useEffect(() => {
    if (!feed || feed.length === 0) return;
    const newest = feed[0]; // feedForConversation is newest-first
    if (!primedFeed.current) {
      primedFeed.current = true;
      lastEventId.current = newest._id;
      return; // prime
    }
    if (newest._id === lastEventId.current) return;
    lastEventId.current = newest._id;
    const line = ambientLineFor(newest);
    if (!line) return;
    fire(line.state, line.text);
  }, [feed, fire]);

  // ----- resolve the final state (one-shot beats out the running/idle base) -----
  const busy = !!runs && runs.some((r) => r.status === "running");
  const state: BlipState = oneShot ?? (busy ? "thinking" : "idle");

  return { state, speech, dismissSpeech, busy };
}

/**
 * Map an event-feed row to a tasteful ambient beat + one-liner. Returns null for
 * kinds that shouldn't surface a bubble (keeps the blip from chattering). FUN,
 * never instructional — and never a prompt for input.
 */
function ambientLineFor(
  ev: EventRow,
): { state: BlipState; text: string } | null {
  const kind = ev.kind.toLowerCase();
  switch (kind) {
    case "found":
    case "sourced":
      return { state: "peek", text: "found a hot lead 👀" };
    case "qualified":
      return { state: "peek", text: "ooh, this one's a fit 👀" };
    case "enriched":
      return { state: "nod", text: "digging up the details…" };
    case "drafted":
      return { state: "nod", text: "drafting something good ✍️" };
    case "sent":
      return { state: "nod", text: "sending…" };
    case "replied":
      return { state: "celebrate", text: "got a reply 🎉" };
    case "rendered":
      return { state: "celebrate", text: "the creative's ready 🎬" };
    default:
      return null;
  }
}

/**
 * A few static "overnight" lines for the proactive-cron beat. The 24/7 cron posts
 * a proactive `messages` row ("overnight I found 3 signals…"); a mount that wants
 * to echo that delight can pass one of these to the bubble. Exported so the
 * companion wrapper can show one when a `proactive` message lands.
 */
export const PROACTIVE_LINES = [
  "overnight I found 3 signals 🌙",
  "while you were away, the swarm kept working ✨",
  "fresh leads waiting for you 👀",
] as const;
