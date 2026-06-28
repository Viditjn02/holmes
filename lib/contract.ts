// ============================================================================
// INTERCEPT — SHARED TYPE CONTRACT (imported by agents, orchestrator, chat, UI)
// ----------------------------------------------------------------------------
// ONE chat → the ROUTER classifies intent → it spawns a RUN that executes the
// matching CAPABILITY on the swarm orchestrator → the canvas renders the result.
//
// This file is the single source of truth for:
//   • Intent  — the capabilities the router can choose                (INTENTS)
//   • Router  — input → capability mapping + classifier guidance      (ROUTER_INTENTS)
//   • Agents  — the full swarm roster + per-capability execution plans (AGENTS / CAPABILITY_PLANS)
//   • Vocab   — unions mirrored from convex/schema.ts validators
//   • Knobs   — tuning constants shared by agents, orchestrator, and UI
//
// Keep in lockstep with convex/schema.ts. Changing a union here is a contract
// change — tell every builder.
// ============================================================================

// ----------------------------------------------------------------------------
// INTENT — what the router decides to DO with a message. Exactly one per turn.
// "chat" / "brain" answer inline in the chat and spawn NO run; the rest spawn a
// run whose `intent` is one of CAPABILITIES.
// ----------------------------------------------------------------------------
export type Intent =
  | "analyze" // full sweep: discovery + competitor + content (default for a bare company)
  | "discovery" // community/thread intent radar — THE MOAT
  | "outbound" // find companies + decision-makers + draft emails
  | "outreach" // act: send / follow up approved drafts
  | "content" // video ad + landing page + ad copy
  | "competitor" // Meta Ad Library winning-ad intel
  | "brain" // gbrain recall — answered inline, no run
  | "chat"; // pure conversation — answered inline, no run

export const INTENTS: readonly Intent[] = [
  "analyze",
  "discovery",
  "outbound",
  "outreach",
  "content",
  "competitor",
  "brain",
  "chat",
] as const;

// The subset that spawns a run (mirrors schema runs.intent validator).
export type Capability = Exclude<Intent, "brain" | "chat">;
export const CAPABILITIES: readonly Capability[] = [
  "analyze",
  "discovery",
  "outbound",
  "outreach",
  "content",
  "competitor",
] as const;

export function spawnsRun(intent: Intent): intent is Capability {
  return (CAPABILITIES as readonly string[]).includes(intent);
}

// ----------------------------------------------------------------------------
// THE SWARM ROSTER. Each agent is an internalAction at convex/agents/<id>.run.
// `board: true` agents get a tile on the live swarm board (an agentStatus row);
// `board: false` agents (router, reply) run silently. `capability` is the work
// surface the agent serves, for the canvas grouping.
// ----------------------------------------------------------------------------
export type AgentId =
  | "router" // resolve canonical domain + classification (phase 0, silent)
  | "enrich" // OrangeSlice firmographics → the brief (icp/positioning)
  | "detective" // Exa/HN/Reddit → real intent-scored threads (the moat)
  | "reply" // draft in-thread community replies (silent)
  | "sourcer" // OrangeSlice + Fiber → prospects (companies + verified emails)
  | "qualifier" // score prospect fit 0-100, drop the misses
  | "writer" // write signal-grounded outbound emails
  | "sender" // send approved emails via AgentMail (the human-approval gate)
  | "follower" // detect replies + schedule/write follow-ups
  | "adscout" // Meta Ad Library → competitor winning ads
  | "creative" // Veo / fal-LTX video ad
  | "designer" // landing page + ad copy
  | "watcher"; // competitor reel teardown (when a reel is configured)

export interface AgentSpec {
  id: AgentId;
  label: string; // human label for the board tile
  capability: Capability;
  board: boolean; // renders a swarm-board tile when true
  blurb: string; // one line shown under the tile while idle
}

export const AGENT_REGISTRY: Readonly<Record<AgentId, AgentSpec>> = {
  router: { id: "router", label: "Router", capability: "analyze", board: false, blurb: "Resolving the target." },
  enrich: { id: "enrich", label: "Enricher", capability: "analyze", board: true, blurb: "Firmographics via Orange Slice." },
  detective: { id: "detective", label: "Detective", capability: "discovery", board: true, blurb: "Hunting live buyer threads." },
  reply: { id: "reply", label: "Responder", capability: "discovery", board: false, blurb: "Drafting in-thread replies." },
  sourcer: { id: "sourcer", label: "Sourcer", capability: "outbound", board: true, blurb: "Companies + verified contacts." },
  qualifier: { id: "qualifier", label: "Qualifier", capability: "outbound", board: true, blurb: "Scoring fit 0-100." },
  writer: { id: "writer", label: "Writer", capability: "outbound", board: true, blurb: "Signal-grounded emails." },
  sender: { id: "sender", label: "Sender", capability: "outreach", board: true, blurb: "Sending via AgentMail." },
  follower: { id: "follower", label: "Follower", capability: "outreach", board: true, blurb: "Replies + follow-ups." },
  adscout: { id: "adscout", label: "Ad Scout", capability: "competitor", board: true, blurb: "Meta Ad Library teardown." },
  creative: { id: "creative", label: "Creative", capability: "content", board: true, blurb: "Veo video ad." },
  designer: { id: "designer", label: "Designer", capability: "content", board: true, blurb: "Landing + ad copy." },
  watcher: { id: "watcher", label: "Watcher", capability: "competitor", board: false, blurb: "Competitor reel teardown." },
};

// Ordered list of every agent id (iteration / typing). NOT the per-run roster —
// the roster is chosen per capability (CAPABILITY_PLANS).
export const AGENTS: readonly AgentId[] = [
  "router",
  "enrich",
  "detective",
  "reply",
  "sourcer",
  "qualifier",
  "writer",
  "sender",
  "follower",
  "adscout",
  "creative",
  "designer",
  "watcher",
] as const;
export type AgentName = AgentId;

// ----------------------------------------------------------------------------
// CAPABILITY PLANS — the orchestrator's phase plan PER intent. Each inner array
// is a phase run with Promise.allSettled (parallel); phases run in order. A
// straggler never blocks the others; the fan-in deadline guarantees settlement.
//
// The orchestrator (convex/run.ts) reads the plan for runs.intent. createRun
// inserts one queued agentStatus row per BOARD agent in the plan.
// ----------------------------------------------------------------------------
export type Phase = readonly AgentId[];
export const CAPABILITY_PLANS: Readonly<Record<Capability, readonly Phase[]>> = {
  // Default bare-company sweep — the original full swarm, intact.
  analyze: [["router"], ["enrich"], ["detective", "adscout"], ["reply", "creative", "designer", "watcher"]],
  // Just the moat.
  discovery: [["router"], ["enrich"], ["detective"], ["reply"]],
  // OrangeSlice + Fiber discovery → qualify → draft emails (gated, not sent).
  outbound: [["router"], ["enrich"], ["sourcer"], ["qualifier"], ["writer"]],
  // Act on already-approved work: send + follow up. No re-discovery.
  outreach: [["sender"], ["follower"]],
  // Content factory off the brief.
  content: [["router"], ["enrich"], ["creative", "designer"]],
  // Competitor intel only.
  competitor: [["router"], ["enrich"], ["adscout", "watcher"]],
};

/** The board-tile agents for a capability (queued rows + board layout). */
export function boardAgentsForIntent(intent: Capability): AgentId[] {
  const seen = new Set<AgentId>();
  for (const phase of CAPABILITY_PLANS[intent]) {
    for (const id of phase) {
      if (AGENT_REGISTRY[id].board) seen.add(id);
    }
  }
  return Array.from(seen);
}

// ----------------------------------------------------------------------------
// ROUTER INTENT MAP — input → capability. The chat router (convex/chat.ts
// `generate`) uses these descriptions/examples to build its classification
// prompt, and `keywords` powers a deterministic heuristic fallback when the LLM
// is unavailable so the router NEVER stalls the chat.
// ----------------------------------------------------------------------------
export interface RouterIntentSpec {
  intent: Intent;
  title: string;
  /** What this capability does — fed to the classifier system prompt. */
  description: string;
  /** Canonical example user messages. */
  examples: readonly string[];
  /** Lowercased trigger tokens for the heuristic fallback (substring match). */
  keywords: readonly string[];
}

export const ROUTER_INTENTS: readonly RouterIntentSpec[] = [
  {
    intent: "discovery",
    title: "Community discovery (the moat)",
    description:
      "Find the LIVE forum/Reddit/HN threads where this company's buyers are asking the exact question it answers, intent-scored and clickable.",
    examples: [
      "find where buyers are talking about resend.com",
      "who's asking about transactional email right now",
      "find live conversations for an open-source Postgres host",
    ],
    keywords: ["where", "conversations", "threads", "reddit", "hacker news", "community", "talking about", "asking", "intent"],
  },
  {
    intent: "outbound",
    title: "Outbound discovery",
    description:
      "Find matching companies and their decision-makers (Orange Slice firmographics + Fiber verified emails) and draft signal-grounded emails for each.",
    examples: [
      "find customers for resend.com",
      "build me a list of fintech Heads of Growth in NYC",
      "who should I sell to and what do I say",
    ],
    keywords: ["find customers", "find leads", "prospects", "companies that", "decision maker", "build a list", "outbound", "sell to", "icp", "emails for"],
  },
  {
    intent: "outreach",
    title: "24/7 outreach",
    description:
      "Act on approved drafts: send via AgentMail and schedule follow-ups. Use when the user approves/sends or asks to follow up.",
    examples: ["send it", "send the approved emails", "follow up with the ones who didn't reply", "ship the outreach"],
    keywords: ["send", "ship it", "follow up", "follow-up", "reach out", "approve and send", "blast"],
  },
  {
    intent: "competitor",
    title: "Competitor intel",
    description:
      "Pull a competitor's currently-running ads from the Meta Ad Library, ranked by run-duration (longevity = a winning angle).",
    examples: ["what ads is brex running", "show me superhuman's winning ads", "teardown competitor X's creative"],
    keywords: ["ads is", "ad library", "competitor", "running ads", "teardown", "what are they running", "winning ads", "meta ads"],
  },
  {
    intent: "content",
    title: "Content generation",
    description:
      "Generate a video ad (Veo / fal-LTX), a landing page, and ad copy from the brief and the buyers' own language.",
    examples: ["make me a video ad", "build a landing page for this", "write ad copy for the campaign", "generate a launch video"],
    keywords: ["video", "make me a", "landing page", "ad copy", "creative", "generate a", "write copy", "launch video"],
  },
  {
    intent: "brain",
    title: "Compounding brain",
    description: "Recall what we learned in past runs from gbrain. Answered inline; no swarm run.",
    examples: ["what did we learn about resend", "what worked last time", "remind me what we found for X"],
    keywords: ["what did we", "last time", "remember", "recall", "previously", "what worked"],
  },
  {
    intent: "analyze",
    title: "Full sweep (default)",
    description:
      "When the user just drops a company name/URL with no specific ask: run the full swarm — discovery + competitor + content — and summarize.",
    examples: ["https://linear.app", "Resend", "vercel.com", "take a look at superhuman"],
    keywords: ["analyze", "take a look", "look at", "research"],
  },
  {
    intent: "chat",
    title: "Conversation",
    description: "Greetings, clarifying questions, or anything that isn't a capability. Reply conversationally; spawn no run.",
    examples: ["hey", "what can you do", "thanks", "explain how this works"],
    keywords: ["hi", "hello", "hey", "thanks", "what can you", "how do you"],
  },
];

/** The router's structured decision for one user message. */
export interface RouterDecision {
  intent: Intent;
  /** The subject to run against (resolved company / url / competitor), if any. */
  subject?: string;
  inputType?: InputType;
  /** A short, friendly sentence to stream back before/while the work runs. */
  ack?: string;
  rationale?: string;
}

// ----------------------------------------------------------------------------
// VOCABULARY — mirrors convex/schema.ts validators.
// ----------------------------------------------------------------------------
export type InputType = "url" | "name" | "competitor" | "community" | "text";

export type RunStatus = "running" | "complete" | "partial" | "failed";
export type RunTrigger = "manual" | "chat" | "cron";
export type AgentRunStatus = "queued" | "running" | "done" | "skipped" | "failed";

export type ChatRole = "user" | "assistant" | "system";

export type CampaignStatus = "draft" | "active" | "paused" | "archived";
export type Autonomy = "review" | "autopilot";

export type ProspectStage =
  | "sourced"
  | "enriched"
  | "qualified"
  | "contacted"
  | "replied"
  | "booked"
  | "skipped";

// Ordered for the pipeline / kanban columns (left -> right). `skipped` is a
// terminal off-ramp rendered separately, not a column.
export const PIPELINE_STAGES: readonly ProspectStage[] = [
  "sourced",
  "enriched",
  "qualified",
  "contacted",
  "replied",
  "booked",
] as const;

export type EmailStatus = "draft" | "approved" | "sent" | "replied" | "bounced" | "skipped";
export type DraftStatus = "awaiting_approval" | "approved" | "rejected" | "posted";

export type SignalType = "funding" | "hiring" | "news" | "post" | "job_change" | "tech" | "other";

// Intent labels for the moat threads.
export type IntentLabel = "browsing" | "comparing" | "frustrated" | "ready_to_buy";

// ----------------------------------------------------------------------------
// AGENT PAYLOAD SHAPES — in-memory contracts agents pass around (they persist
// their own results to Convex; these are the typed hand-offs).
// ----------------------------------------------------------------------------

export interface Signal {
  type: SignalType;
  summary: string;
  url?: string;
  source?: string;
  foundAt: number;
}

// DISCOVERY (the moat) — what the detective returns.
export interface DiscoveredThread {
  platform: string; // "reddit" | "hackernews" | "forum"
  url: string;
  title: string;
  snippet: string;
  intentScore: number; // 0-100
  intentLabel: IntentLabel;
  author?: string;
  communityName?: string;
}

export interface DiscoveredCommunity {
  name: string;
  platform: string;
  url: string;
  why: string;
}

export interface ReplyDraft {
  threadUrl: string;
  body: string;
  confidence: number; // 0-1
}

// ENRICH — the resolved brief context for a run.
export interface EnrichResult {
  company: string;
  icp: string;
  positioning: string;
}

// OUTBOUND — sourcer → qualifier → writer hand-offs.
export interface SourcedProspect {
  company: string;
  domain?: string;
  name?: string;
  title?: string;
  linkedinUrl?: string;
  location?: string;
  industry?: string;
}

export interface EnrichedProspect extends SourcedProspect {
  employeeCount?: string;
  email?: string;
  emailVerified?: boolean; // true only when Fiber verified it
  signal?: Signal;
  source?: string; // orangeslice | fiber | exa | html-fallback
}

export interface Qualification {
  fitScore: number; // 0-100
  fitReason: string;
  qualified: boolean; // fitScore >= QUALIFY_THRESHOLD
}

export interface DraftedEmail {
  step: number; // 0 = first touch, 1+ = follow-up
  kind: "initial" | "followup";
  subject: string;
  body: string;
  signalRef?: string;
}

// The seller context the swarm runs against (campaign brief).
export interface CampaignBrief {
  company: string;
  domain?: string;
  description?: string;
  icp: string;
  positioning?: string;
  personas?: string[];
  valueProp?: string;
}

// Deterministic replay fixture — scripts/seed-demo.ts loads this so the on-camera
// run is instant and cannot flop. fixtures/<slug>.json conforms to this shape.
export interface ReplayFixture {
  input: string;
  enrich: EnrichResult;
  communities: DiscoveredCommunity[];
  threads: DiscoveredThread[];
  drafts: ReplyDraft[];
  creativeUrl: string; // pre-rendered Veo clip (public URL or /public path)
}

// ----------------------------------------------------------------------------
// TUNING KNOBS — shared so agents, orchestrator, and UI agree on the numbers.
// ----------------------------------------------------------------------------
export const FANIN_DEADLINE_MS = 90_000; // hard cap; board renders regardless

// Discovery (the moat).
export const MAX_COMMUNITIES = 5;
export const MAX_THREADS = 8;

// Outbound.
export const MAX_PROSPECTS_PER_RUN = 12; // sourcer cap per swarm cycle
export const QUALIFY_THRESHOLD = 60; // fitScore >= this -> qualified

// Follow-up cadence: day offsets from the initial send for each sequence step.
// step 0 is the first touch (day 0); steps 1..N are follow-ups.
export const SEQUENCE_DELAYS_DAYS: readonly number[] = [0, 3, 7, 14] as const;
export const MAX_SEQUENCE_STEPS = SEQUENCE_DELAYS_DAYS.length;

// Deliverability guardrails (signal-based outbound; keep it tight).
export const MAX_EMAIL_WORDS = 150;
export const MAX_LINKS_PER_EMAIL = 1;

// 24/7 campaign cron cadence.
export const DEFAULT_CADENCE_MINUTES = 60;
export const MIN_CADENCE_MINUTES = 15;
