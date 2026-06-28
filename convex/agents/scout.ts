// ============================================================================
// INTERCEPT — SCOUT AGENT  ·  GITHUB ARTIFACT INTELLIGENCE
// ----------------------------------------------------------------------------
// Point at an EVENT / hackathon / GitHub org / topic / competitor and enumerate
// the REAL projects being built there. The honest, demo-safe inversion (see
// scratchpad/research/event-osint-feasibility.md): we start at the ARTIFACT the
// builder published (the repo), never a private attendee roster.
//
//   DISCOVER  → GitHub Search API (token-OPTIONAL via GITHUB_TOKEN) / org repos
//   FILTER    → token match (+ recent-created window for hackathons) → de-noise
//   ENUMERATE → /repos/{o}/{r}, /contributors (team), /readme (+ manifest)
//   ANALYZE   → OpenAI chatJSON → { whatTheyreBuilding, stack, maturity, pros,
//               cons, gtmAngle, confidence } per repo
//   EMIT      → one `projects` row per repo, sorted by signal
//
// HONEST: every row carries confidence + provenance (matchedOn/source), empty
// repos are LABELED (isEmpty + maturity "empty"), never hallucinated. Public-data
// only — NO attendee/phone OSINT.
//
// GRACEFUL: no GitHub network / no OpenAI key → fewer/empty rows, NEVER throws.
//
// RUNTIME: NOT a "use node" file (it owns the `saveProjects` mutation +
// `projectsForRun` query per the agent contract). lib/github + lib/openai are
// fetch-based and run in Convex's default runtime.
// ============================================================================

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import {
  SCOUT_MAX_CANDIDATES,
  SCOUT_MAX_REPOS,
  SCOUT_README_MAX_CHARS,
  type ScoutMode,
  type ScoutProject,
  type ProjectMaturity,
  type ScoutTeamMember,
} from "../../lib/contract";
import { chatJSON } from "../../lib/openai";
import {
  searchRepositories,
  listOrgRepos,
  getRepo,
  getContributors,
  getReadme,
  getManifest,
  type GithubRepo,
} from "../../lib/github";

const VALID_MATURITY: readonly ProjectMaturity[] = [
  "empty",
  "placeholder",
  "prototype",
  "mvp",
  "production",
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "this", "that", "from", "what",
  "everyone", "people", "building", "project", "projects", "repo", "repos",
  "github", "hackathon", "event", "org", "topic", "competitor", "scout",
  "analyze", "dissect", "are", "list",
]);

// ============================================================================
// run — the agent entrypoint (orchestrator invokes this via the swarmpool)
// ============================================================================
export const run = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<{ projects: number }> => {
    const run = await ctx.runQuery(internal.runs.getRunInternal, { runId });
    if (!run) throw new Error(`scout: run ${runId} not found`);

    const seed = (run.input ?? run.company ?? "").trim();
    if (!seed) {
      await ctx.runMutation(internal.agents.scout.saveProjects, { runId, projects: [] });
      return { projects: 0 };
    }

    // 1. interpret the seed → mode + query + de-noise tokens.
    const plan = buildPlan(seed);

    // 2. DISCOVER — candidate repos (graceful: [] on no network / rate-limit).
    //    Search lanes UNION across the full + relaxed queries (deduped by repo);
    //    repos found via a `specific` (>=3-term AND) query are trusted past the
    //    token de-noise below.
    let candidates: GithubRepo[];
    const trusted = new Set<string>();
    if (plan.mode === "org") {
      candidates = await listOrgRepos(plan.orgOrTopic ?? seed, SCOUT_MAX_CANDIDATES);
    } else {
      const byName = new Map<string, GithubRepo>();
      for (const { q, specific } of plan.queries) {
        const found = await searchRepositories(q, {
          sort: "updated",
          order: "desc",
          perPage: SCOUT_MAX_CANDIDATES,
        });
        for (const r of found) {
          const key = r.fullName.toLowerCase();
          if (!byName.has(key)) byName.set(key, r);
          if (specific) trusted.add(key);
        }
        // Enough signal already — skip the broader relaxed lanes.
        if (byName.size >= SCOUT_MAX_REPOS * 2) break;
      }
      candidates = Array.from(byName.values());
    }

    // 3. FILTER / DE-NOISE — drop forks/archived; in search mode require a
    //    distinctive seed token in name/description/topics (drops wrong-event
    //    false positives) UNLESS the repo is trusted (matched a specific query).
    //    Empty repos are KEPT (and labeled later), not dropped.
    candidates = denoise(candidates, plan, trusted);

    // Rank by signal (stars, then recency, then README presence proxy via size)
    // and cap the enumerate set so a token-free run stays inside the rate limit.
    const repos = rankRepos(candidates).slice(0, SCOUT_MAX_REPOS);

    if (repos.length === 0) {
      await ctx.runMutation(internal.agents.scout.saveProjects, { runId, projects: [] });
      return { projects: 0 };
    }

    // 4. ENUMERATE + ANALYZE each repo (parallel, fully isolated per repo).
    const settled = await Promise.allSettled(
      repos.map((repo) => enumerateAndAnalyze(repo, plan)),
    );
    const projects = settled
      .filter(
        (s): s is PromiseFulfilledResult<ScoutProject> => s.status === "fulfilled",
      )
      .map((s) => s.value);

    // 5. EMIT — persist, populated repos first, then by confidence.
    const sorted = [...projects].sort((a, b) => {
      if (a.isEmpty !== b.isEmpty) return a.isEmpty ? 1 : -1;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return (b.stars ?? 0) - (a.stars ?? 0);
    });

    await ctx.runMutation(internal.agents.scout.saveProjects, {
      runId,
      projects: sorted,
    });

    return { projects: sorted.length };
  },
});

// ============================================================================
// PLAN — interpret the seed into a GitHub query lane.
// ============================================================================
interface ScoutQuery {
  q: string; // the raw `q` passed to GitHub search
  specific: boolean; // GitHub ANDs >=3 distinctive event terms → trust the hit
}

interface ScoutPlan {
  mode: ScoutMode;
  queries: ScoutQuery[]; // search/topic lanes, ordered specific → relaxed
  orgOrTopic?: string; // the resolved org login or topic slug
  tokens: string[]; // distinctive de-noise tokens
  matchedOn: string; // provenance label
  source: string; // github_search | github_org | github_topic
}

/** Parse the seed into the right GitHub query. Pure + total (never throws). */
export function buildPlan(seed: string): ScoutPlan {
  const raw = seed.trim();
  const lower = raw.toLowerCase();
  const tokens = distinctiveTokens(raw);

  // Explicit org: "github.com/orgs/<x>", "github.com/<x>", "org:<x>", "@<x>".
  const org = extractOrg(raw);
  if (org) {
    return {
      mode: "org",
      queries: [],
      orgOrTopic: org,
      tokens: [],
      matchedOn: "org membership",
      source: "github_org",
    };
  }

  // Explicit topic: "topic:<x>" or "<x> topic"/"topic <x>".
  const topic = extractTopic(lower);
  if (topic) {
    return {
      mode: "topic",
      queries: [{ q: `topic:${topic}`, specific: true }],
      orgOrTopic: topic,
      tokens: [topic.replace(/-/g, " ")],
      matchedOn: "topic tag",
      source: "github_topic",
    };
  }

  // Default: full-text repository search. We pass the seed UNQUOTED so GitHub ANDs
  // the terms (wrapping the whole multi-word seed in ONE quote pair demands an
  // exact contiguous phrase and returns nothing). The catch: ANDing EVERY word of
  // a long seed (e.g. an event name + its venue/table — "… Orange Slice") collapses
  // recall, because few repos mention the venue. So we emit the full query AND a
  // progressively relaxed prefix that drops the trailing venue tokens, then UNION
  // the hits. A repo matched by a query that ANDs >=3 distinctive terms is
  // `specific` → trusted past the token de-noise (GitHub already proved it on-topic,
  // even when the match lived in the README rather than the name/description).
  // For hackathons a recent-created window drops stale, same-named false positives.
  return {
    mode: "search",
    queries: buildSearchQueries(raw, lower),
    tokens,
    matchedOn: "repo text match",
    source: "github_search",
  };
}

/** Full seed → progressively relaxed prefixes (+ hackathon created window). */
function buildSearchQueries(raw: string, lower: string): ScoutQuery[] {
  const base = raw.replace(/"/g, "").trim();
  const window = lower.includes("hackathon")
    ? ` created:>=${isoDaysAgo(45)}`
    : "";
  const words = base.split(/\s+/).filter(Boolean);

  const out: ScoutQuery[] = [];
  const seen = new Set<string>();
  const push = (text: string): void => {
    const t = text.trim();
    if (!t) return;
    const q = `${t}${window}`.trim();
    if (seen.has(q)) return;
    seen.add(q);
    out.push({ q, specific: t.split(/\s+/).filter(Boolean).length >= 3 });
  };

  push(base);
  // Relax only long seeds: drop the trailing 2 tokens (typically venue/table noise)
  // down to a >=3-word event core, so the event phrase still ANDs precisely.
  if (words.length >= 5) push(words.slice(0, words.length - 2).join(" "));
  // Drop a short leading acronym (e.g. "YC", "AI") — builders often omit the
  // umbrella org from their repo text, so the un-prefixed phrase still ANDs the
  // event but catches those repos too.
  if (words.length >= 4 && words[0].length <= 2) push(words.slice(1).join(" "));
  return out;
}

// ============================================================================
// ENUMERATE + ANALYZE one repo → a ScoutProject.
// ============================================================================
async function enumerateAndAnalyze(
  searchRepo: GithubRepo,
  plan: ScoutPlan,
): Promise<ScoutProject> {
  // Refresh full metadata (search results omit some fields); fall back to the
  // search row when the detail call is rate-limited.
  const repo = (await getRepo(searchRepo.fullName)) ?? searchRepo;

  const [team, readme, manifest] = await Promise.all([
    getContributors(repo.fullName, 8),
    getReadme(repo.fullName),
    getManifest(repo.fullName),
  ]);

  const readmeText = (readme ?? "").trim();
  const hasContent = readmeText.length > 40 || repo.sizeKb > 12;

  const provenance = {
    repoUrl: repo.htmlUrl,
    repoFullName: repo.fullName,
    description: repo.description ?? undefined,
    team,
    stars: repo.stars,
    language: repo.language ?? undefined,
    createdAtGh: repo.createdAt || undefined,
    updatedAtGh: repo.pushedAt || repo.updatedAt || undefined,
    matchedOn: plan.matchedOn,
    source: plan.source,
  };

  // Empty / placeholder repo — HONEST, never hallucinated.
  if (!hasContent) {
    const placeholder = repo.description && repo.description.trim().length > 0;
    return {
      project: repo.name,
      whatTheyreBuilding: placeholder
        ? `Repo created with a description but no public code yet: "${truncate(repo.description!.trim(), 160)}"`
        : "Repo created, no public code or README yet (placeholder push).",
      stack: repo.language ? [repo.language] : [],
      maturity: placeholder ? "placeholder" : "empty",
      pros: [],
      cons: ["No analyzable code/README yet — analysis withheld."],
      gtmAngle: undefined,
      confidence: 0.2,
      isEmpty: true,
      ...provenance,
    };
  }

  // ANALYZE with OpenAI; deterministic heuristic fallback when the key is absent
  // or the call fails, so a populated repo always gets a real card.
  const analysis = await analyzeRepo(repo, readmeText, manifest);

  return {
    project: analysis.project || repo.name,
    whatTheyreBuilding: analysis.whatTheyreBuilding,
    stack: analysis.stack,
    maturity: analysis.maturity,
    pros: analysis.pros,
    cons: analysis.cons,
    gtmAngle: analysis.gtmAngle,
    confidence: analysis.confidence,
    isEmpty: false,
    ...provenance,
  };
}

interface RepoAnalysis {
  project: string;
  whatTheyreBuilding: string;
  stack: string[];
  maturity: ProjectMaturity;
  pros: string[];
  cons: string[];
  gtmAngle?: string;
  confidence: number;
}

async function analyzeRepo(
  repo: GithubRepo,
  readme: string,
  manifest: { path: string; content: string } | null,
): Promise<RepoAnalysis> {
  const heuristic = heuristicAnalysis(repo, readme);
  try {
    const result = await chatJSON<{
      project?: string;
      whatTheyreBuilding?: string;
      stack?: string[];
      maturity?: string;
      pros?: string[];
      cons?: string[];
      gtmAngle?: string;
      confidence?: number;
    }>({
      system:
        "You are INTERCEPT's artifact analyst. Given a single GitHub project (repo " +
        "metadata + README, maybe a manifest), produce an HONEST teardown for a GTM " +
        "operator. Judge ONLY from the provided text — do not invent features. If the " +
        "README is thin, say so and lower confidence. Return STRICT JSON.",
      user: JSON.stringify({
        repo: {
          fullName: repo.fullName,
          description: repo.description,
          language: repo.language,
          topics: repo.topics,
          stars: repo.stars,
          createdAt: repo.createdAt,
          pushedAt: repo.pushedAt,
        },
        manifest: manifest
          ? { path: manifest.path, content: truncate(manifest.content, 1500) }
          : null,
        readme: truncate(readme, SCOUT_README_MAX_CHARS),
        instructions:
          'Return {"project": string (display name), "whatTheyreBuilding": string ' +
          "(2-3 sentences: the problem + their approach), \"stack\": string[] (concrete " +
          "tech/frameworks/APIs you can SEE referenced), \"maturity\": one of " +
          '"empty"|"placeholder"|"prototype"|"mvp"|"production", "pros": string[] (2-4 ' +
          'real strengths), "cons": string[] (2-4 honest gaps/risks), "gtmAngle": string ' +
          "(one sentence: the go-to-market read — who'd buy this / the wedge), " +
          '"confidence": number 0..1 (how sure you are given the README depth)}.',
      }),
      temperature: 0.3,
      maxTokens: 900,
    });

    const maturity = normalizeMaturity(result.maturity) ?? heuristic.maturity;
    const stack = cleanList(result.stack);
    const pros = cleanList(result.pros);
    const cons = cleanList(result.cons);
    return {
      project: (result.project ?? "").trim() || heuristic.project,
      whatTheyreBuilding:
        (result.whatTheyreBuilding ?? "").trim() || heuristic.whatTheyreBuilding,
      stack: stack.length > 0 ? stack : heuristic.stack,
      maturity,
      pros: pros.length > 0 ? pros : heuristic.pros,
      cons: cons.length > 0 ? cons : heuristic.cons,
      gtmAngle: (result.gtmAngle ?? "").trim() || heuristic.gtmAngle,
      confidence: clamp01(
        typeof result.confidence === "number" ? result.confidence : heuristic.confidence,
      ),
    };
  } catch {
    return heuristic;
  }
}

// ============================================================================
// Deterministic fallback analysis (so a populated repo always renders).
// ============================================================================
function heuristicAnalysis(repo: GithubRepo, readme: string): RepoAnalysis {
  const firstLine = readme
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0 && !l.startsWith("![") && !l.startsWith("<"));
  const summary =
    (repo.description && repo.description.trim()) ||
    (firstLine && truncate(firstLine, 200)) ||
    `A ${repo.language ?? "software"} project on GitHub.`;

  const stack = inferStack(repo, readme);
  const maturity = inferMaturity(repo, readme);
  const confidence = Math.min(
    0.7,
    0.3 + Math.min(readme.length, 4000) / 8000 + (repo.stars > 5 ? 0.1 : 0),
  );

  return {
    project: repo.name,
    whatTheyreBuilding: summary,
    stack,
    maturity,
    pros: [
      repo.stars > 0 ? `${repo.stars} star${repo.stars === 1 ? "" : "s"} on GitHub` : "Public, inspectable codebase",
      readme.length > 600 ? "Has a substantive README" : "Ships a working repo",
    ],
    cons: [
      readme.length < 600 ? "Thin README — hard to fully assess" : "Analysis is README-only (no deep code read)",
    ],
    gtmAngle: undefined,
    confidence: clamp01(confidence),
  };
}

function inferStack(repo: GithubRepo, readme: string): string[] {
  const hay = `${readme}\n${repo.topics.join(" ")}`.toLowerCase();
  const out = new Set<string>();
  if (repo.language) out.add(repo.language);
  const probes: [RegExp, string][] = [
    [/\bnext\.?js\b/, "Next.js"],
    [/\breact\b/, "React"],
    [/\bconvex\b/, "Convex"],
    [/\bsupabase\b/, "Supabase"],
    [/\bpostgres\b/, "Postgres"],
    [/\bopenai\b|gpt-4|gpt-3/, "OpenAI"],
    [/\banthropic\b|claude/, "Anthropic"],
    [/\bgemini\b/, "Gemini"],
    [/\blangchain\b/, "LangChain"],
    [/\bfastapi\b/, "FastAPI"],
    [/\bflask\b/, "Flask"],
    [/\bdjango\b/, "Django"],
    [/\bexpress\b/, "Express"],
    [/\btailwind\b/, "Tailwind"],
    [/\bvercel\b/, "Vercel"],
    [/\bdocker\b/, "Docker"],
    [/\btypescript\b/, "TypeScript"],
  ];
  for (const [re, label] of probes) if (re.test(hay)) out.add(label);
  return Array.from(out).slice(0, 8);
}

function inferMaturity(repo: GithubRepo, readme: string): ProjectMaturity {
  if (repo.sizeKb < 12 && readme.length < 200) return "empty";
  if (readme.length < 200) return "placeholder";
  if (repo.stars >= 50 || readme.length > 3000) return "production";
  if (repo.sizeKb > 400 || readme.length > 1200) return "mvp";
  return "prototype";
}

// ============================================================================
// DE-NOISE + RANK helpers.
// ============================================================================
function denoise(
  repos: GithubRepo[],
  plan: ScoutPlan,
  trusted: Set<string>,
): GithubRepo[] {
  const seen = new Set<string>();
  const out: GithubRepo[] = [];
  for (const r of repos) {
    const key = r.fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.isFork || r.isArchived) continue;
    if (plan.mode === "search" && plan.tokens.length > 0 && !trusted.has(key)) {
      const hay = `${r.name} ${r.description ?? ""} ${r.topics.join(" ")}`.toLowerCase();
      if (!plan.tokens.some((t) => hay.includes(t))) continue;
    }
    out.push(r);
  }
  return out;
}

function rankRepos(repos: GithubRepo[]): GithubRepo[] {
  return [...repos].sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars;
    const ta = Date.parse(a.pushedAt || a.updatedAt) || 0;
    const tb = Date.parse(b.pushedAt || b.updatedAt) || 0;
    return tb - ta;
  });
}

// ============================================================================
// Persistence (defined HERE per the agent contract).
// ============================================================================
const teamValidator = v.array(
  v.object({
    login: v.string(),
    contributions: v.number(),
    url: v.optional(v.string()),
  }),
);

const projectValidator = v.object({
  project: v.string(),
  repoUrl: v.string(),
  repoFullName: v.string(),
  description: v.optional(v.string()),
  whatTheyreBuilding: v.string(),
  stack: v.array(v.string()),
  maturity: v.string(),
  pros: v.array(v.string()),
  cons: v.array(v.string()),
  gtmAngle: v.optional(v.string()),
  confidence: v.number(),
  team: teamValidator,
  stars: v.optional(v.number()),
  language: v.optional(v.string()),
  createdAtGh: v.optional(v.string()),
  updatedAtGh: v.optional(v.string()),
  isEmpty: v.boolean(),
  matchedOn: v.string(),
  source: v.string(),
});

export const saveProjects = internalMutation({
  args: {
    runId: v.id("runs"),
    projects: v.array(projectValidator),
  },
  handler: async (ctx, { runId, projects }): Promise<number> => {
    const now = Date.now();
    for (const p of projects) {
      await ctx.db.insert("projects", { runId, ...p, generatedAt: now });
    }
    return projects.length;
  },
});

export const projectsForRun = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
  },
});

// ============================================================================
// Small pure helpers.
// ============================================================================
function distinctiveTokens(seed: string): string[] {
  return Array.from(
    new Set(
      seed
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
    ),
  ).slice(0, 6);
}

function extractOrg(seed: string): string | null {
  const s = seed.trim();
  let m = s.match(/github\.com\/orgs\/([A-Za-z0-9-]+)/i);
  if (m) return m[1];
  m = s.match(/^org:([A-Za-z0-9-]+)$/i);
  if (m) return m[1];
  m = s.match(/github\.com\/([A-Za-z0-9-]+)\/?$/i);
  if (m) return m[1];
  m = s.match(/^@([A-Za-z0-9-]+)$/);
  if (m) return m[1];
  return null;
}

function extractTopic(lower: string): string | null {
  let m = lower.match(/topic:([a-z0-9-]+)/);
  if (m) return m[1];
  m = lower.match(/\btagged\s+([a-z0-9-]+)\b/);
  if (m) return m[1];
  m = lower.match(/\btopic\s+([a-z0-9-]+)\b/);
  if (m) return m[1];
  return null;
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function normalizeMaturity(value: unknown): ProjectMaturity | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (VALID_MATURITY as string[]).includes(v) ? (v as ProjectMaturity) : null;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x.length > 0)
    .slice(0, 6);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.4;
  return Math.max(0, Math.min(1, n));
}

function truncate(text: string, max: number): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

// Re-export the type for callers that want the in-memory shape.
export type { ScoutProject, ScoutTeamMember };
