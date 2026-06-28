// ============================================================================
// INTERCEPT — GITHUB CLIENT (artifact intelligence / scout)
// ----------------------------------------------------------------------------
// A small, GRACEFUL, rate-limit-aware GitHub REST client for the scout agent.
// Public-data only. The token is OPTIONAL (process.env.GITHUB_TOKEN) — it only
// raises the rate limit (60→5000 core, 10→30 search per minute). With no token
// the client still works for a single demo run.
//
// EVERY call degrades to [] / null on ANY failure (missing/blocked network,
// 403 rate-limit, 404, malformed JSON) so nothing the scout does can throw or
// block a run. Fetches go through safeFetch (SSRF guard + 15s timeout + size
// cap), so this is import-safe in Convex's DEFAULT runtime (no node builtins).
//
// READMEs are fetched with `Accept: application/vnd.github.raw` so we get UTF-8
// text directly and never have to base64-decode in the default runtime.
// ============================================================================

import { safeFetch } from "./safeFetch";
import type { ScoutTeamMember } from "./contract";

const GITHUB_API = "https://api.github.com";

/** Normalized public repo shape (a subset of the GitHub repo object). */
export interface GithubRepo {
  fullName: string; // "owner/repo"
  name: string;
  owner: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number; // repo size in KB (0 ⇒ effectively empty)
  topics: string[];
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  defaultBranch: string;
  isFork: boolean;
  isArchived: boolean;
}

/** Search options for {@link searchRepositories}. */
export interface SearchOpts {
  sort?: "stars" | "forks" | "updated" | "help-wanted-issues";
  order?: "asc" | "desc";
  perPage?: number;
}

// ----------------------------------------------------------------------------
// Auth + low-level fetch (always graceful).
// ----------------------------------------------------------------------------

/** True when a GITHUB_TOKEN is configured (used only for honest provenance). */
export function githubTokenPresent(): boolean {
  return !!process.env.GITHUB_TOKEN?.trim();
}

function baseHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "intercept-scout",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** True when the response is a rate-limit refusal (so callers can stop early). */
function isRateLimited(res: Response): boolean {
  if (res.status !== 403 && res.status !== 429) return false;
  const remaining = res.headers.get("x-ratelimit-remaining");
  return remaining === "0" || res.status === 429;
}

/** GET a GitHub API path and parse JSON. Returns null on any failure. */
async function ghJSON<T>(path: string, accept?: string): Promise<T | null> {
  try {
    const headers = baseHeaders();
    if (accept) headers.Accept = accept;
    const res = await safeFetch(`${GITHUB_API}${path}`, {
      method: "GET",
      headers,
      timeoutMs: 12_000,
    });
    if (!res.ok) return null; // 403/404/5xx — graceful empty
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** GET a GitHub API path and return raw TEXT (for READMEs/manifests). */
async function ghRaw(path: string): Promise<string | null> {
  try {
    const headers = baseHeaders();
    headers.Accept = "application/vnd.github.raw";
    const res = await safeFetch(`${GITHUB_API}${path}`, {
      method: "GET",
      headers,
      timeoutMs: 12_000,
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Normalization.
// ----------------------------------------------------------------------------

interface RawRepo {
  full_name?: string;
  name?: string;
  owner?: { login?: string } | null;
  html_url?: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  size?: number;
  topics?: string[];
  created_at?: string;
  updated_at?: string;
  pushed_at?: string;
  default_branch?: string;
  fork?: boolean;
  archived?: boolean;
}

function normalizeRepo(r: RawRepo): GithubRepo | null {
  const fullName = (r.full_name ?? "").trim();
  if (!fullName.includes("/")) return null;
  const [owner, name] = fullName.split("/");
  return {
    fullName,
    name: r.name ?? name,
    owner: r.owner?.login ?? owner,
    htmlUrl: r.html_url ?? `https://github.com/${fullName}`,
    description: r.description ?? null,
    language: r.language ?? null,
    stars: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
    forks: typeof r.forks_count === "number" ? r.forks_count : 0,
    openIssues: typeof r.open_issues_count === "number" ? r.open_issues_count : 0,
    sizeKb: typeof r.size === "number" ? r.size : 0,
    topics: Array.isArray(r.topics) ? r.topics.filter((t) => typeof t === "string") : [],
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
    pushedAt: r.pushed_at ?? r.updated_at ?? "",
    defaultBranch: r.default_branch ?? "main",
    isFork: r.fork === true,
    isArchived: r.archived === true,
  };
}

// ----------------------------------------------------------------------------
// DISCOVER — GitHub Search API.
// ----------------------------------------------------------------------------

/**
 * Search repositories. `query` is the raw `q` (callers build it with qualifiers
 * like `"AI Growth Hackathon" created:2026-06-27..2026-06-29`). Returns [] on
 * any failure or rate-limit.
 */
export async function searchRepositories(
  query: string,
  opts: SearchOpts = {},
): Promise<GithubRepo[]> {
  const q = query.trim();
  if (!q) return [];
  const params = new URLSearchParams({
    q,
    sort: opts.sort ?? "updated",
    order: opts.order ?? "desc",
    per_page: String(Math.max(1, Math.min(opts.perPage ?? 20, 50))),
  });
  const data = await ghJSON<{ items?: RawRepo[] }>(
    `/search/repositories?${params.toString()}`,
  );
  if (!data?.items) return [];
  return data.items
    .map(normalizeRepo)
    .filter((r): r is GithubRepo => r !== null);
}

/** Enumerate an org's public repos (most-recently-pushed first). [] on failure. */
export async function listOrgRepos(
  org: string,
  perPage = 30,
): Promise<GithubRepo[]> {
  const name = org.trim().replace(/^@/, "");
  if (!name) return [];
  const params = new URLSearchParams({
    sort: "pushed",
    direction: "desc",
    per_page: String(Math.max(1, Math.min(perPage, 100))),
    type: "public",
  });
  const data = await ghJSON<RawRepo[]>(
    `/orgs/${encodeURIComponent(name)}/repos?${params.toString()}`,
  );
  // Fall back to the user-repos endpoint when the handle is a user, not an org.
  const rows =
    data ??
    (await ghJSON<RawRepo[]>(
      `/users/${encodeURIComponent(name)}/repos?${params.toString()}`,
    ));
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizeRepo).filter((r): r is GithubRepo => r !== null);
}

// ----------------------------------------------------------------------------
// ENUMERATE — per-repo detail, contributors, README.
// ----------------------------------------------------------------------------

/** Fetch a single repo's metadata. null on failure. */
export async function getRepo(fullName: string): Promise<GithubRepo | null> {
  const f = fullName.trim();
  if (!f.includes("/")) return null;
  const raw = await ghJSON<RawRepo>(`/repos/${f}`);
  return raw ? normalizeRepo(raw) : null;
}

interface RawContributor {
  login?: string;
  contributions?: number;
  html_url?: string;
  type?: string;
}

/** The repo's contributors (the builders) as public handles. [] on failure. */
export async function getContributors(
  fullName: string,
  max = 8,
): Promise<ScoutTeamMember[]> {
  const f = fullName.trim();
  if (!f.includes("/")) return [];
  const rows = await ghJSON<RawContributor[]>(
    `/repos/${f}/contributors?per_page=${Math.max(1, Math.min(max, 30))}`,
  );
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((c) => typeof c.login === "string" && c.type !== "Bot")
    .slice(0, max)
    .map((c) => ({
      login: c.login as string,
      contributions: typeof c.contributions === "number" ? c.contributions : 0,
      url: c.html_url ?? `https://github.com/${c.login}`,
    }));
}

/** The repo's README as raw UTF-8 text (truncated by the caller). null when none. */
export async function getReadme(fullName: string): Promise<string | null> {
  const f = fullName.trim();
  if (!f.includes("/")) return null;
  return await ghRaw(`/repos/${f}/readme`);
}

/**
 * Best-effort fetch of a manifest file (package.json, requirements.txt, etc.) for
 * stack inference. null when absent. Tries each path until one resolves.
 */
export async function getManifest(
  fullName: string,
  paths: string[] = ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Cargo.toml"],
): Promise<{ path: string; content: string } | null> {
  const f = fullName.trim();
  if (!f.includes("/")) return null;
  for (const path of paths) {
    const content = await ghRaw(`/repos/${f}/contents/${encodeURIComponent(path)}`);
    if (content) return { path, content };
  }
  return null;
}
