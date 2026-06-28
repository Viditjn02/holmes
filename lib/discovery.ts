// ============================================================================
// INTERCEPT — LIVE-THREAD DISCOVERY  (Exa, with a FREE $0 fallback)
// ----------------------------------------------------------------------------
// THE MOAT depends on real, clickable URLs to LIVE conversations where buyers are
// asking the exact question a company answers. Exa is the premium source, but it
// needs credits. So this module degrades to TWO key-free public APIs so the moat
// works at $0:
//
//   • Hacker News  → Algolia search API   https://hn.algolia.com/api/v1/search
//   • Reddit       → public search JSON    https://www.reddit.com/search.json
//
// Both are real, clickable, and need no API key. `discoverThreads` tries Exa
// first (when EXA_API_KEY is set), then falls back to HN + Reddit, returning the
// SAME `ExaThread` shape the detective already consumes — a drop-in replacement.
// It never throws: an empty array is the worst case.
// ============================================================================

import { searchThreads, type ExaThread } from "./exa";
import { safeFetch } from "./safeFetch";

const FREE_TIMEOUT_MS = 10_000;
const USER_AGENT = "InterceptBot/1.0 (+https://intercept.app; community discovery)";

export interface DiscoverThreadsArgs {
  /** Buyer-intent search query. Required, non-empty. */
  query: string;
  /** How many threads to pull back. Defaults to 6. */
  numResults?: number;
  /** Domains to bias Exa toward (ignored by the free fallback). */
  includeDomains?: string[];
  /** Exa search mode. */
  type?: "keyword" | "neural" | "auto";
}

/** True when a real Exa key is configured. */
export function hasExaKey(): boolean {
  return Boolean(process.env.EXA_API_KEY?.trim());
}

function toSnippet(raw: string | undefined, max = 400): string {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

// ----------------------------------------------------------------------------
// FREE source 1 — Hacker News via the public Algolia API (no key).
// ----------------------------------------------------------------------------
async function searchHackerNews(
  query: string,
  numResults: number,
): Promise<ExaThread[]> {
  const url =
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
    `&tags=(story,comment)&hitsPerPage=${Math.max(1, Math.min(20, numResults))}`;
  try {
    const resp = await safeFetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      timeoutMs: FREE_TIMEOUT_MS,
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { hits?: Array<Record<string, unknown>> };
    const hits = Array.isArray(data.hits) ? data.hits : [];
    const out: ExaThread[] = [];
    for (const hit of hits) {
      const objectId = String(hit.objectID ?? hit.story_id ?? "").trim();
      const title =
        (typeof hit.title === "string" && hit.title) ||
        (typeof hit.story_title === "string" && hit.story_title) ||
        "";
      const body =
        (typeof hit.comment_text === "string" && hit.comment_text) ||
        (typeof hit.story_text === "string" && hit.story_text) ||
        "";
      if (!objectId || (!title && !body)) continue;
      out.push({
        url: `https://news.ycombinator.com/item?id=${objectId}`,
        title: stripHtml(title || body).slice(0, 160) || "Hacker News discussion",
        snippet: toSnippet(stripHtml(body || title)),
        author: typeof hit.author === "string" ? hit.author : undefined,
        publishedDate:
          typeof hit.created_at === "string" ? hit.created_at : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// FREE source 2 — Reddit via the public search JSON (no key).
// ----------------------------------------------------------------------------
async function searchReddit(
  query: string,
  numResults: number,
): Promise<ExaThread[]> {
  const url =
    `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}` +
    `&limit=${Math.max(1, Math.min(25, numResults))}&sort=relevance&type=link`;
  try {
    const resp = await safeFetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      timeoutMs: FREE_TIMEOUT_MS,
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      data?: { children?: Array<{ data?: Record<string, unknown> }> };
    };
    const children = data.data?.children ?? [];
    const out: ExaThread[] = [];
    for (const child of children) {
      const post = child.data;
      if (!post) continue;
      const permalink = typeof post.permalink === "string" ? post.permalink : "";
      const title = typeof post.title === "string" ? post.title : "";
      if (!permalink || !title) continue;
      const body =
        (typeof post.selftext === "string" && post.selftext) ||
        (typeof post.subreddit === "string" ? `r/${post.subreddit}` : "");
      out.push({
        url: `https://www.reddit.com${permalink}`,
        title: title.slice(0, 160),
        snippet: toSnippet(body || title),
        author: typeof post.author === "string" ? post.author : undefined,
        publishedDate:
          typeof post.created_utc === "number"
            ? new Date(post.created_utc * 1000).toISOString()
            : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/\s+/g, " ")
    .trim();
}

// ----------------------------------------------------------------------------
// PUBLIC: discoverThreads — Exa first, then the free HN + Reddit fallback.
// ----------------------------------------------------------------------------
/**
 * Find live, clickable buyer-intent threads. Tries Exa when a key is present,
 * else (or on Exa failure / empty result) falls back to the free HN + Reddit
 * public APIs. Returns the detective's `ExaThread` shape. Never throws.
 */
export async function discoverThreads(
  args: DiscoverThreadsArgs,
): Promise<ExaThread[]> {
  const query = args.query.trim();
  if (!query) return [];
  const numResults = args.numResults ?? 6;

  // Premium path: Exa (when credits are configured).
  if (hasExaKey()) {
    try {
      const exaResults = await searchThreads({
        query,
        numResults,
        includeDomains: args.includeDomains,
        type: args.type,
      });
      if (exaResults.length > 0) return exaResults;
    } catch {
      // Exa down / out of credits — fall through to the free sources.
    }
  }

  // Free $0 path: HN + Reddit in parallel.
  const perSource = Math.max(2, Math.ceil(numResults / 2));
  const [hn, reddit] = await Promise.all([
    searchHackerNews(query, perSource),
    searchReddit(query, perSource),
  ]);

  // Interleave so a single source can't dominate the mix.
  const merged: ExaThread[] = [];
  const max = Math.max(hn.length, reddit.length);
  for (let i = 0; i < max; i++) {
    if (reddit[i]) merged.push(reddit[i]);
    if (hn[i]) merged.push(hn[i]);
  }
  return merged.slice(0, numResults);
}
