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
  | "content" // AD FACTORY (create): similar ad — image + copy + variations + video
  | "competitor" // AD INTELLIGENCE (scan): multi-platform ad scan + scoring
  | "replicate" // drop a post/ad URL → improved replica (copy + image + variations)
  | "social" // algorithm hacking: trend scan + viral posts + reel + calendar
  | "onboarding" // zero-to-one PLG: generate an in-app onboarding flow/tour
  | "scout" // GitHub artifact intelligence: event/org/topic → dissect the projects
  | "brain" // gbrain recall — answered inline, no run
  | "chat"; // pure conversation — answered inline, no run

export const INTENTS: readonly Intent[] = [
  "analyze",
  "discovery",
  "outbound",
  "outreach",
  "content",
  "competitor",
  "replicate",
  "social",
  "onboarding",
  "scout",
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
  "replicate",
  "social",
  "onboarding",
  "scout",
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
  | "adscout" // multi-platform ad scan + per-ad performance scoring (SCAN)
  | "creative" // Veo / fal-LTX video ad
  | "adsmith" // similar ad: AI image + copy + variations (CREATE / REPLICATE)
  | "watcher" // competitor reel teardown (when a reel is configured)
  // --- Track 1: ALGORITHM HACKING (social / virality engine) ---
  | "trendscout" // live trend + topic scan (Exa → HN/Reddit fallback)
  | "composer" // multi-variant viral posts, scored by the virality model
  | "reelmaker" // short vertical video (fal/LTX), hook-driven script
  | "calendar" // content calendar scheduling the generated posts
  // --- Track 2: SALES CYBORGS depth (prospect digital twin) ---
  | "twin" // simulates + scores each drafted email before send
  // --- Track 3: ZERO-TO-ONE PLG (onboarding flow generator) ---
  | "guide" // generates an in-app onboarding flow / product tour
  // --- GitHub artifact intelligence (scout) ---
  | "scout"; // event/org/topic → discover + dissect the real GitHub projects

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
  adscout: { id: "adscout", label: "Ad Scout", capability: "competitor", board: true, blurb: "Multi-platform ad scan + scoring." },
  creative: { id: "creative", label: "Creative", capability: "content", board: true, blurb: "Veo video ad." },
  adsmith: { id: "adsmith", label: "Ad Smith", capability: "content", board: true, blurb: "Similar ad: image + copy + variations." },
  watcher: { id: "watcher", label: "Watcher", capability: "competitor", board: false, blurb: "Competitor reel teardown." },
  // Track 1 — algorithm hacking (social).
  trendscout: { id: "trendscout", label: "Trend Scout", capability: "social", board: true, blurb: "Live trend + topic scan." },
  composer: { id: "composer", label: "Composer", capability: "social", board: true, blurb: "Multi-variant viral posts." },
  reelmaker: { id: "reelmaker", label: "Reel Maker", capability: "social", board: true, blurb: "Short vertical video (fal)." },
  calendar: { id: "calendar", label: "Calendar", capability: "social", board: true, blurb: "Content calendar." },
  // Track 2 — sales cyborgs (digital twin), serves the outbound surface.
  twin: { id: "twin", label: "Digital Twin", capability: "outbound", board: true, blurb: "Simulates + scores each draft." },
  // Track 3 — zero-to-one PLG (onboarding).
  guide: { id: "guide", label: "Onboarding Guide", capability: "onboarding", board: true, blurb: "Generates a product tour." },
  // GitHub artifact intelligence (scout).
  scout: { id: "scout", label: "Scout", capability: "scout", board: true, blurb: "Dissecting the projects on GitHub." },
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
  "adsmith",
  "watcher",
  "trendscout",
  "composer",
  "reelmaker",
  "calendar",
  "twin",
  "guide",
  "scout",
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
  // Default bare-company sweep — full swarm, now grounded by the adscout scan.
  // adsmith runs BEFORE creative so the gpt-image-1 ad image is ready when the
  // video lane reads it → the free Ken-Burns fast path fires (seconds, not the
  // slow Pexels path). Creative degrades gracefully if the image isn't done.
  analyze: [["router"], ["enrich"], ["detective", "adscout"], ["reply", "adsmith", "watcher"], ["creative"]],
  // Just the moat.
  discovery: [["router"], ["enrich"], ["detective"], ["reply"]],
  // OrangeSlice + Fiber discovery → qualify → draft emails (gated, not sent).
  // The digital twin runs LAST: it reads the writer's drafts and scores them.
  outbound: [["router"], ["enrich"], ["sourcer"], ["qualifier"], ["writer"], ["twin"]],
  // Act on already-approved work: send + follow up. No re-discovery.
  outreach: [["sender"], ["follower"]],
  // AD FACTORY (create) — scan FIRST, make the image+copy (adsmith), THEN the
  // video (creative), so the gpt-image-1 image is ready and the video lane can
  // animate it via the free Ken-Burns fast path (seconds) instead of the slow
  // Pexels download path. Both are grounded in the live scan's winning angles.
  content: [["router"], ["enrich"], ["adscout"], ["adsmith"], ["creative"]],
  // AD INTELLIGENCE (scan) — scan + score; watcher optional reel teardown.
  competitor: [["router"], ["enrich"], ["adscout", "watcher"]],
  // REPLICATE — drop a post/ad URL → improved replica (adsmith reads run.sourceUrl).
  replicate: [["router"], ["enrich"], ["adsmith"]],
  // Algorithm hacking: trend scan → compose posts + render a reel (parallel) → calendar.
  social: [["router"], ["enrich"], ["trendscout"], ["composer", "reelmaker"], ["calendar"]],
  // Zero-to-one PLG: enrich the product context → generate the onboarding flow.
  onboarding: [["router"], ["enrich"], ["guide"]],
  // GitHub artifact intelligence: scout self-contains discover → enumerate → analyze.
  // It needs no company enrich (the seed IS an event/org/topic), so it runs solo.
  scout: [["scout"]],
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
    title: "Ad intelligence (scan)",
    description:
      "Discover a company's REAL competitors, then scan THEIR live ads across Google + Meta + TikTok with NO API token, rank by performance score + run-duration, show active status. (A pre-revenue startup runs no ads of its own — its rivals do.)",
    examples: ["what ads are nolongerjobless.com's competitors running", "scan superhuman's competitor ads", "show me the top ads in brex's category"],
    keywords: ["ads is", "ad library", "competitor", "competitors", "rivals", "alternatives", "running ads", "teardown", "what are they running", "winning ads", "meta ads", "google ads", "what's working", "top ads", "tiktok ads", "scan ads"],
  },
  {
    intent: "content",
    title: "Ad factory (create)",
    description:
      "Generate a similar ad — AI image + primary copy + 3 variations — grounded in the competitor's winning angles, plus a video ad.",
    examples: ["make me a similar ad for brex", "generate an ad for this", "make an image ad for the campaign", "generate a launch video"],
    keywords: ["video", "make me a", "ad copy", "creative", "generate a", "write copy", "launch video", "similar ad", "generate an ad", "ad creative", "make an ad", "image ad"],
  },
  {
    intent: "replicate",
    title: "Replicate + improve",
    description:
      "Take a post or ad URL the user drops and produce an improved replica (copy + image + variations).",
    examples: ["here's an ad, make it better", "replicate this post <url>", "improve this creative"],
    keywords: ["replicate", "recreate", "improve this", "make this better", "clone this ad", "copy this post"],
  },
  {
    intent: "social",
    title: "Algorithm hacking (virality)",
    description:
      "Scan what's trending for this company's market, spin up multi-variant viral posts scored by a virality model, render a short vertical video, and lay it all out on a content calendar.",
    examples: [
      "make this go viral",
      "spin up posts + a reel for resend.com",
      "what's trending for AI email",
    ],
    keywords: ["viral", "trend", "trending", "posts", "reel", "tiktok", "linkedin post", "content calendar", "go viral", "short video"],
  },
  {
    intent: "onboarding",
    title: "Zero-to-one (PLG onboarding)",
    description:
      "Generate an in-app onboarding flow / product tour for the user's product, grounded in its value prop, with a live preview and a copy-paste embed snippet.",
    examples: [
      "build an onboarding flow for my app",
      "make a product tour for resend.com",
      "design a first-run experience",
    ],
    keywords: ["onboarding", "product tour", "walkthrough", "first run", "activation", "plg", "shepherd", "tooltip tour", "getting started"],
  },
  {
    intent: "scout",
    title: "GitHub artifact intelligence (scout)",
    description:
      "Point at an event/hackathon, a GitHub org, a topic, or a competitor and enumerate the REAL projects being built there: discover repos via the GitHub Search API, read each repo's README + manifests, and produce a per-project teardown (what they're building, stack, maturity, pros/cons, GTM angle) with confidence + provenance. Public-data only.",
    examples: [
      "what is everyone building at the AI Growth Hackathon",
      "scout projects for the orange slice hackathon",
      "analyze the repos in github org vercel",
      "dissect the projects tagged llm-agents",
    ],
    keywords: [
      "what is everyone building",
      "what's everyone building",
      "scout projects",
      "scout the",
      "hackathon",
      "github org",
      "github topic",
      "analyze the repos",
      "dissect the repos",
      "what are people building",
      "projects being built",
      "repos for",
    ],
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

// ----------------------------------------------------------------------------
// VIDEO AD ASPECT — landscape vs portrait option for the Creative video lane.
// The user-facing option is `AdAspect`; every video provider (WaveSpeed / Veo /
// fal) and the local Ken-Burns worker speak the `AspectRatio` wire string. The
// option is threaded creative.ts → providers + worker via `aspectRatioFor`.
// ----------------------------------------------------------------------------
/** User-facing orientation option for the generated video ad. */
export type AdAspect = "portrait" | "landscape";
/** The wire aspect-ratio string every video provider + the worker accept. */
export type AspectRatio = "9:16" | "16:9";
/** Default orientation — vertical, built for the feeds the buyers live in. */
export const DEFAULT_AD_ASPECT: AdAspect = "portrait";
/** Map the orientation option → the provider/worker aspect-ratio string. */
export function aspectRatioFor(aspect: AdAspect): AspectRatio {
  return aspect === "landscape" ? "16:9" : "9:16";
}

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

// ----------------------------------------------------------------------------
// TRACK 1 — ALGORITHM HACKING (social / virality). In-memory hand-offs between
// trendscout → composer → reelmaker → calendar. Each agent persists its own rows
// (trends / posts / contentCalendar / creatives); these are the typed contracts.
// ----------------------------------------------------------------------------

// A single trend the trendscout surfaced for the run's market.
export interface TrendHit {
  topic: string;
  angle: string;
  source: string; // "exa" | "hackernews" | "reddit"
  url?: string;
  score: number; // 0-100 momentum
  why: string;
}

// The virality model's per-post breakdown (sub-scores feed the overall score).
export interface ViralityScore {
  score: number; // 0-100 overall
  breakdown: {
    hook: number;
    emotion: number;
    clarity: number;
    timeliness: number;
    cta: number;
  };
}

// One composed post variant for a given platform, scored by the virality model.
export interface PostVariant {
  platform: string; // "linkedin" | "x" | "tiktok" | "instagram"
  variant: number;
  hook: string;
  body: string;
  hashtags: string[];
  angle: string;
  trendRef?: string;
  virality: ViralityScore;
}

// One slot in the generated content calendar.
export interface CalendarSlot {
  dayOffset: number;
  platform: string;
  title: string;
  scheduledLabel: string;
  status: string; // "planned"
}

// ----------------------------------------------------------------------------
// TRACK 2 — SALES CYBORGS (prospect digital twin). The twin simulates a buyer
// reading a drafted email and scores it before send. Shared so the writer can
// call the same simulator (flag-guarded) to ship the best variant.
// ----------------------------------------------------------------------------
export interface TwinSimulation {
  replyLikelihood: number; // 0-100
  sentiment: string; // "positive" | "neutral" | "negative"
  predictedReply: string;
  objections: string[];
  suggestions: string[];
  score: number; // 0-100 overall
  model?: string;
}

// ----------------------------------------------------------------------------
// TRACK 3 — ZERO-TO-ONE PLG (onboarding). The guide produces a structured tour;
// lib/onboarding (convex/onboarding) turns it into a paste-ready embed snippet.
// ----------------------------------------------------------------------------
export interface OnboardingStep {
  order: number;
  target: string; // CSS selector hint
  title: string;
  body: string;
  placement: string; // "top" | "bottom" | "left" | "right" | "center"
  cta?: string;
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

// Track 1 — algorithm hacking (social / virality).
export const MAX_TREND_QUERIES = 5; // trend queries the trendscout derives from the brief
export const POST_VARIANTS_PER_PLATFORM = 3; // variants the composer drafts per platform
export const SOCIAL_PLATFORMS: readonly string[] = ["linkedin", "x", "tiktok", "instagram"] as const;
export const MAX_CALENDAR_DAYS = 14; // calendar horizon the scheduler spreads posts across

// Track 2 — sales cyborgs (digital twin).
export const TWIN_REPLY_THRESHOLD = 50; // replyLikelihood >= this -> "likely to reply"

// Track 3 — zero-to-one PLG (onboarding).
export const ONBOARDING_STEP_MIN = 4; // floor on generated tour steps
export const ONBOARDING_STEP_MAX = 7; // ceiling on generated tour steps

// ----------------------------------------------------------------------------
// AD FACTORY engine — shared types for the scan/create/replicate
// flows. adscout SCANS (→ `ads`), adsmith CREATES/REPLICATES (→ `adCreatives`).
// These are the typed in-memory hand-offs; agents persist their own rows.
// ----------------------------------------------------------------------------
// Google = the token-free Ads Transparency Center lane (the PRIMARY network: it
// needs zero keys — a plain server-side JSON-RPC fetch — and is the only one that
// reliably returns a *named advertiser's* live creatives + first/last-shown dates).
export type AdNetwork = "meta" | "tiktok" | "google";
export type AdMediaType = "image" | "video" | "carousel" | "unknown";

/** 5-axis ad performance breakdown, 0-100 each. */
export interface AdScores {
  hook: number;
  clarity: number;
  cta: number;
  quality: number;
  engagement: number;
}

/** A scanned competitor ad (adscout → `ads` table). Most fields optional so a
 *  thin scan still renders. `source` records which lane surfaced it. */
export interface ScannedAd {
  network: AdNetwork;
  platform: string;
  advertiser: string;
  headline?: string;
  text: string;
  cta?: string;
  mediaType: AdMediaType;
  imageUrl?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  firstSeen?: string;
  lastSeen?: string;
  daysRunning?: number;
  status: string; // "active" | "inactive"
  engagement?: { likes?: number; comments?: number; shares?: number };
  url: string;
  source: string; // google_atc | browser_meta | apify_meta | tiktok_list | apify_tiktok | meta_api
  perfScore?: number;
  scores?: AdScores;
  scalingSignal?: boolean;
  winningAngle?: string;
}

/** One copy variation produced by adsmith. */
export interface AdVariation {
  headline: string;
  primaryText: string;
  cta: string;
  angle: string;
}

/** A generated similar/replica ad (adsmith → `adCreatives` table). */
export interface GeneratedAd {
  kind: "image_ad" | "replica";
  groundedOnAdId?: string;
  sourceUrl?: string;
  headline: string;
  primaryText: string;
  cta: string;
  variations: AdVariation[];
  strategy: string;
  imagePrompt: string;
  imageUrl?: string;
  imageStatus: "done" | "degraded" | "failed";
  degraded: boolean;
  degradedReason?: string;
  model: string;
}

// Ad-factory tuning knobs.
export const MAX_SCAN_ADS = 12; // gallery cap
export const AD_VARIATIONS = 3; // copy variations per generated ad
export const SCAN_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h scan cache
export const SCALING_MIN_DAYS = 21; // active + ≥21d running ⇒ scalingSignal

// ----------------------------------------------------------------------------
// GITHUB ARTIFACT INTELLIGENCE (scout) — point at an event/org/topic/competitor,
// the scout DISCOVERS the real repos (GitHub Search API), ENUMERATES each
// (repo + contributors + README), and ANALYZES them (OpenAI chatJSON) into a
// per-project teardown. Public-data only; graceful (no token/key → empty, never
// throws). These are the typed in-memory hand-offs; the agent persists `projects`.
// ----------------------------------------------------------------------------

/** How the scout interpreted the seed → which GitHub query lane it ran. */
export type ScoutMode = "search" | "org" | "topic";

/** Project maturity, inferred from README depth + repo activity. "empty" and
 *  "placeholder" are HONESTLY labeled (a repo pushed only to satisfy a rule). */
export type ProjectMaturity =
  | "empty" // no README/code yet — placeholder push
  | "placeholder" // description only, near-empty
  | "prototype" // some README/code, early
  | "mvp" // working build with real README
  | "production"; // mature, documented, active

/** One builder on a repo (from the contributors API — public handles only). */
export interface ScoutTeamMember {
  login: string;
  contributions: number;
  url?: string;
}

/** The analyzed project card (scout → `projects` table). Most analysis fields are
 *  required (the analyzer always emits them, with safe fallbacks for empty repos). */
export interface ScoutProject {
  project: string; // human project name (README/repo name)
  repoUrl: string; // canonical https GitHub URL
  repoFullName: string; // "owner/repo"
  description?: string; // repo description (provenance)
  whatTheyreBuilding: string; // the teardown one-liner+
  stack: string[]; // inferred tech stack
  maturity: ProjectMaturity;
  pros: string[];
  cons: string[];
  gtmAngle?: string; // the GTM read
  confidence: number; // 0-1 — honest analysis confidence
  team: ScoutTeamMember[];
  stars?: number;
  language?: string;
  createdAtGh?: string; // ISO repo created_at
  updatedAtGh?: string; // ISO repo pushed_at/updated_at
  isEmpty: boolean; // labeled empty/placeholder (graceful)
  matchedOn: string; // provenance: "repo text match" | "org membership" | "topic tag"
  source: string; // "github_search" | "github_org" | "github_topic"
}

// Scout tuning knobs.
export const SCOUT_MAX_CANDIDATES = 18; // raw search results to consider
export const SCOUT_MAX_REPOS = 8; // repos we fully enumerate + analyze (rate-limit safe)
export const SCOUT_README_MAX_CHARS = 6000; // README slice fed to the analyzer
