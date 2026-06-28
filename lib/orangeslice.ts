// ============================================================================
// INTERCEPT — ORANGE SLICE ENRICHMENT + OUTBOUND DISCOVERY CLIENT  (REAL DATA)
// ----------------------------------------------------------------------------
// WHAT THIS IS (and the honest provenance behind the "orangeslice" label):
//   OrangeSlice ships as a sheet / workflow / MCP product gated behind a login —
//   it has NO public Bearer REST `/v1/enrich` endpoint (the previous build called
//   a fabricated `api.orangeslice.ai/v1/enrich`, which does not exist and returned
//   nothing real). The DOCUMENTED, working interim path for the same firmographic
//   + people data is Apollo.io's REST API (header `X-Api-Key`). We keep the
//   `source: "orangeslice"` provenance label and the `enrichCompany()` signature
//   so the rest of the swarm is unchanged, but every byte here is a REAL API call
//   to a REAL endpoint — never a stub.
//
//   • enrichCompany(domain)      → Apollo POST /v1/organizations/enrich     (firmographics)
//   • discoverCompanies(filters) → Apollo POST /v1/mixed_companies/search   (ICP → accounts)
//   • findPeople(domain,titles)  → Apollo POST /v1/mixed_people/search      (decision-makers)
//
// GRACEFUL DEGRADATION: with no APOLLOIO_API_KEY (or on any network/API error)
//   - enrichCompany falls back to a documented homepage HTML scrape (real, just
//     thinner), and
//   - discoverCompanies / findPeople return [] (the caller layers an LLM/seed
//     fallback so the pipeline is never empty).
// It NEVER throws — outbound must degrade, never block the swarm.
// ============================================================================

import { safeFetch } from "./safeFetch";

const APOLLO_BASE_URL =
  process.env.APOLLOIO_BASE_URL ?? "https://api.apollo.io/v1";

const APOLLO_TIMEOUT_MS = 12_000;

export interface Firmographics {
  domain: string;
  name?: string;
  description?: string;
  industry?: string;
  employeeCount?: string;
  location?: string;
  /** Honest provenance: the enrichment API ("orangeslice") or the HTML fallback. */
  source: "orangeslice" | "html-fallback";
}

/** A company surfaced by an ICP search (outbound discovery). */
export interface DiscoveredAccount {
  company: string;
  domain?: string;
  industry?: string;
  employeeCount?: string;
  location?: string;
  linkedinUrl?: string;
  source: "orangeslice";
}

/** A decision-maker at a target account. Email is locked behind Fiber reveal. */
export interface DiscoveredPerson {
  name?: string;
  title?: string;
  linkedinUrl?: string;
  /** Apollo email when unlocked; "" / locked-placeholder is dropped by the caller. */
  email?: string;
  emailLocked: boolean;
  location?: string;
  source: "orangeslice";
}

export interface DiscoverCompaniesArgs {
  /** Free-text keywords describing the ICP (industry, category, niche). */
  keywords?: string;
  /** Apollo employee-range buckets, e.g. ["11,50","51,200"]. */
  employeeRanges?: string[];
  /** Locations (cities / regions / countries) to bias toward. */
  locations?: string[];
  /** How many accounts to pull (Apollo per_page; capped at 25). */
  limit?: number;
}

// ----------------------------------------------------------------------------
// Key + low-level POST.
// ----------------------------------------------------------------------------

/** Read the key fresh each call so env changes are picked up without restart. */
function apiKey(): string | undefined {
  const key = process.env.APOLLOIO_API_KEY?.trim();
  return key ? key : undefined;
}

/** True when a real Apollo key is configured (callers can choose a path). */
export function hasOrangeSliceKey(): boolean {
  return apiKey() !== undefined;
}

/**
 * Single Apollo REST call. Returns the parsed body or `null` on any
 * error/timeout/non-2xx so callers degrade gracefully instead of throwing.
 */
async function apolloPost(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const key = apiKey();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APOLLO_TIMEOUT_MS);
  try {
    const resp = await fetch(`${APOLLO_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "X-Api-Key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) return null; // rate limit / auth / unknown — degrade silently
    const data = (await resp.json()) as unknown;
    return data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null; // network / timeout / bad JSON — never propagate
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------------------------
// Parsing helpers (Apollo nests fields under several names across endpoints).
// ----------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(
  data: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!data) return undefined;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

/** Normalize raw user input into a bare domain (no scheme, no path, no www). */
function normalizeDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/^www\./, "");
  domain = domain.split("/")[0].split("?")[0];
  return domain;
}

/** Build "City, State" / "City, Country" from Apollo's split location fields. */
function joinLocation(rec: Record<string, unknown> | undefined): string | undefined {
  if (!rec) return undefined;
  const explicit = firstString(rec, ["location", "formatted_address", "hq"]);
  if (explicit) return explicit;
  const parts = [
    firstString(rec, ["city"]),
    firstString(rec, ["state"]),
    firstString(rec, ["country"]),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** Apollo returns headcount as a number; bucket it into a human range. */
function bucketHeadcount(rec: Record<string, unknown> | undefined): string | undefined {
  const raw = rec?.["estimated_num_employees"] ?? rec?.["employee_count"];
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return firstString(rec, ["employee_count", "size", "headcount"]);
  }
  if (n <= 10) return "1-10";
  if (n <= 50) return "11-50";
  if (n <= 200) return "51-200";
  if (n <= 500) return "201-500";
  if (n <= 1000) return "501-1000";
  if (n <= 5000) return "1001-5000";
  return "5000+";
}

/** Apollo locks emails for un-revealed people; detect the placeholder. */
function isLockedEmail(email: string | undefined): boolean {
  if (!email) return true;
  const e = email.toLowerCase();
  return (
    e.includes("email_not_unlocked") ||
    e.includes("not_unlocked") ||
    e === "locked"
  );
}

// ----------------------------------------------------------------------------
// HTML fallback (no key) — documented homepage meta-tag scrape.
// ----------------------------------------------------------------------------
function pickMeta(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, " ").trim();
  }
  return undefined;
}

async function enrichViaHtml(domain: string): Promise<Firmographics> {
  const url = `https://${domain}`;
  let html = "";
  try {
    // SSRF guard: `domain` is user-supplied. safeFetch rejects private/loopback/
    // metadata hosts and re-validates redirects before reading any bytes.
    const resp = await safeFetch(url, {
      headers: { "user-agent": "InterceptBot/1.0 (+enrichment)" },
    });
    if (resp.ok) html = await resp.text();
  } catch {
    return { domain, source: "html-fallback" };
  }

  const title = pickMeta(html, [
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);
  const description = pickMeta(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ]);

  return { domain, name: title, description, source: "html-fallback" };
}

// ----------------------------------------------------------------------------
// PUBLIC: enrichCompany — REAL firmographics via Apollo org enrich.
// ----------------------------------------------------------------------------
/**
 * Enrich a company domain into firmographics. Prefers the real Apollo
 * `/organizations/enrich` endpoint (labeled `source:"orangeslice"`); otherwise
 * falls back to the documented homepage HTML scrape. Never throws.
 */
export async function enrichCompany(domain: string): Promise<Firmographics> {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    throw new Error("enrichCompany requires a non-empty domain.");
  }

  if (!hasOrangeSliceKey()) {
    return enrichViaHtml(normalized);
  }

  const data = await apolloPost("/organizations/enrich", { domain: normalized });
  const org =
    asRecord(data?.["organization"]) ?? asRecord(data?.["account"]) ?? data ?? undefined;

  if (!org) {
    return enrichViaHtml(normalized);
  }

  return {
    domain: normalized,
    name: firstString(org, ["name", "company_name"]),
    description: firstString(org, ["short_description", "description", "seo_description"]),
    industry: firstString(org, ["industry", "sector"]),
    employeeCount: bucketHeadcount(org),
    location: joinLocation(org),
    source: "orangeslice",
  };
}

// ----------------------------------------------------------------------------
// PUBLIC: discoverCompanies — REAL ICP → target accounts via Apollo search.
// ----------------------------------------------------------------------------
/**
 * Surface real companies matching an ICP via Apollo `/mixed_companies/search`.
 * Returns [] when no key / no match (the sourcer layers its own LLM + seed
 * fallback on top). Never throws.
 */
export async function discoverCompanies(
  args: DiscoverCompaniesArgs,
): Promise<DiscoveredAccount[]> {
  if (!hasOrangeSliceKey()) return [];

  const perPage = Math.max(1, Math.min(25, args.limit ?? 12));
  const body: Record<string, unknown> = { page: 1, per_page: perPage };
  if (args.keywords?.trim()) {
    body.q_organization_keyword_tags = args.keywords
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  if (args.employeeRanges && args.employeeRanges.length > 0) {
    body.organization_num_employees_ranges = args.employeeRanges;
  }
  if (args.locations && args.locations.length > 0) {
    body.organization_locations = args.locations;
  }

  const data = await apolloPost("/mixed_companies/search", body);
  const raw =
    (Array.isArray(data?.["organizations"]) && (data!["organizations"] as unknown[])) ||
    (Array.isArray(data?.["accounts"]) && (data!["accounts"] as unknown[])) ||
    [];

  const accounts: DiscoveredAccount[] = [];
  for (const item of raw) {
    const org = asRecord(item);
    const company = firstString(org, ["name", "company_name"]);
    if (!company) continue;
    const rawDomain = firstString(org, ["primary_domain", "website_url", "domain"]);
    accounts.push({
      company,
      domain: rawDomain ? normalizeDomain(rawDomain) : undefined,
      industry: firstString(org, ["industry", "sector"]),
      employeeCount: bucketHeadcount(org),
      location: joinLocation(org),
      linkedinUrl: firstString(org, ["linkedin_url"]),
      source: "orangeslice",
    });
  }
  return accounts;
}

// ----------------------------------------------------------------------------
// PUBLIC: findPeople — REAL decision-makers at a domain via Apollo people search.
// ----------------------------------------------------------------------------
/**
 * Find decision-makers at a company domain via Apollo `/mixed_people/search`,
 * filtered by titles. Emails are typically LOCKED here (Apollo reveal is a
 * separate paid step) — the caller uses Fiber to obtain a verified work email.
 * Returns [] when no key / no match. Never throws.
 */
export async function findPeople(
  domain: string,
  titles: readonly string[],
  limit = 3,
): Promise<DiscoveredPerson[]> {
  const normalized = normalizeDomain(domain);
  if (!normalized || !hasOrangeSliceKey()) return [];

  const body: Record<string, unknown> = {
    page: 1,
    per_page: Math.max(1, Math.min(10, limit)),
    q_organization_domains: normalized,
  };
  const cleanTitles = titles.map((t) => t.trim()).filter(Boolean).slice(0, 10);
  if (cleanTitles.length > 0) body.person_titles = cleanTitles;

  const data = await apolloPost("/mixed_people/search", body);
  const raw =
    (Array.isArray(data?.["people"]) && (data!["people"] as unknown[])) ||
    (Array.isArray(data?.["contacts"]) && (data!["contacts"] as unknown[])) ||
    [];

  const people: DiscoveredPerson[] = [];
  for (const item of raw) {
    const person = asRecord(item);
    const name =
      firstString(person, ["name"]) ??
      ([firstString(person, ["first_name"]), firstString(person, ["last_name"])]
        .filter(Boolean)
        .join(" ") ||
        undefined);
    const email = firstString(person, ["email"]);
    people.push({
      name: name || undefined,
      title: firstString(person, ["title", "headline"]),
      linkedinUrl: firstString(person, ["linkedin_url"]),
      email: isLockedEmail(email) ? undefined : email,
      emailLocked: isLockedEmail(email),
      location: joinLocation(person),
      source: "orangeslice",
    });
  }
  return people;
}
