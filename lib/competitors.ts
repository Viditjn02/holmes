// ============================================================================
// INTERCEPT — COMPETITOR DISCOVERY (domain → real, advertising rivals)
// ----------------------------------------------------------------------------
// THE missing step in front of the ad scan. The old adscout scanned the ad
// libraries for ads run BY the target company — but a pre-revenue startup
// (e.g. nolongerjobless.com) runs ZERO ads, so every lane came back empty. This
// turns a domain into a list of REAL competitors who DO advertise, so the scan
// has something to actually find.
//
// Strategy (graceful, layered — mirrors lib/sourcing.ts):
//   1. PRIMARY — OpenAI chatJSON. The LLM reliably knows the competitive set of
//      any established category (for nolongerjobless.com → Teal, Simplify, Huntr,
//      LazyApply, Sonara, LoopCV…). Costs nothing new: the OpenAI key is already
//      a hard dep for ad scoring, so this works with ZERO Orange Slice key.
//   2. GROUND — Orange Slice Ocean `discoverCompanies` (lookalike by category)
//      when a key is present. Purely additive, deduped by brand/domain.
//   3. FALLBACK — a deterministic, LLM-free seed by category keyword so the
//      pipeline is never empty even with no OpenAI + no Orange Slice key.
//
// CONTRACT: NEVER throws. Runs in the Convex default runtime (chatJSON + the
// Orange Slice fetch wrappers, no node-only deps) so adscout imports it directly.
// ============================================================================

import { chatJSON } from "./openai";
import { enrichCompany, discoverCompanies, hasOrangeSliceKey } from "./orangeslice";
import { webScrape, supadataEnabled } from "./supadata";

export interface Competitor {
  name: string;
  domain?: string;
  why?: string;
}

/**
 * A lightweight, dossier-ready read of a single competitor: what they're
 * building plus their strengths/gaps. Derived from a Supadata homepage scrape →
 * OpenAI summary. Purely additive — omitted entirely when the scrape/LLM is
 * unavailable, so callers always treat it as optional.
 */
export interface CompetitorAnalysis {
  whatTheyreBuilding: string;
  pros: string[];
  cons: string[];
}

export interface AnalyzeCompetitorsOpts {
  /** How many of the top competitors to analyze (clamped 1..3). */
  limit?: number;
}

export interface DiscoverCompetitorsOpts {
  /** Firmographics if the caller already enriched (saves a round-trip). */
  firmographics?: { name?: string; description?: string; industry?: string };
  /** Hard cap on rivals returned (clamped to 3..12). */
  limit?: number;
}

// ----------------------------------------------------------------------------
// Deterministic seed map (no-key fallback). Real, currently-advertising brands
// per broad category — same philosophy as sourcing.ts SEED_COMPANIES: never show
// an empty or obviously-fake set. Matched by keyword against the firmographics
// industry/description and the domain itself.
// ----------------------------------------------------------------------------
interface CategorySeed {
  keywords: readonly string[];
  competitors: readonly Competitor[];
}

const CATEGORY_SEEDS: readonly CategorySeed[] = [
  {
    keywords: ["job", "career", "resume", "apply", "hiring", "applicant", "recruit"],
    competitors: [
      { name: "Teal", domain: "tealhq.com", why: "AI resume + job application tracker" },
      { name: "Simplify", domain: "simplify.jobs", why: "1-click autofill job applications" },
      { name: "Huntr", domain: "huntr.co", why: "Job application tracker board" },
      { name: "LazyApply", domain: "lazyapply.com", why: "Automated mass job applying" },
      { name: "Sonara", domain: "sonara.ai", why: "AI auto-apply to jobs" },
      { name: "LoopCV", domain: "loopcv.pro", why: "Automated job application loop" },
      { name: "Careerflow", domain: "careerflow.ai", why: "AI job search copilot" },
    ],
  },
  {
    keywords: ["email", "transactional", "newsletter", "smtp", "deliverability"],
    competitors: [
      { name: "Mailgun", domain: "mailgun.com", why: "Transactional email API" },
      { name: "SendGrid", domain: "sendgrid.com", why: "Email delivery platform" },
      { name: "Postmark", domain: "postmarkapp.com", why: "Transactional email" },
      { name: "Loops", domain: "loops.so", why: "Email for SaaS" },
      { name: "Customer.io", domain: "customer.io", why: "Lifecycle messaging" },
    ],
  },
  {
    keywords: ["crm", "sales", "outbound", "prospect", "pipeline", "gtm", "lead"],
    competitors: [
      { name: "Apollo", domain: "apollo.io", why: "Sales engagement + data" },
      { name: "Outreach", domain: "outreach.io", why: "Sales execution platform" },
      { name: "Clay", domain: "clay.com", why: "GTM data enrichment" },
      { name: "Instantly", domain: "instantly.ai", why: "Cold email automation" },
      { name: "Lemlist", domain: "lemlist.com", why: "Outbound sequences" },
    ],
  },
  {
    keywords: ["design", "creative", "image", "video", "ad", "marketing", "content"],
    competitors: [
      { name: "Canva", domain: "canva.com", why: "Design + ad creative" },
      { name: "AdCreative.ai", domain: "adcreative.ai", why: "AI ad creative generation" },
      { name: "Jasper", domain: "jasper.ai", why: "AI marketing copy" },
      { name: "Copy.ai", domain: "copy.ai", why: "AI copywriting" },
      { name: "Pencil", domain: "trypencil.com", why: "AI ad generation" },
    ],
  },
  {
    keywords: ["fintech", "bank", "payment", "card", "spend", "expense", "finance"],
    competitors: [
      { name: "Ramp", domain: "ramp.com", why: "Corporate cards + spend" },
      { name: "Brex", domain: "brex.com", why: "Corporate cards + banking" },
      { name: "Mercury", domain: "mercury.com", why: "Startup banking" },
      { name: "Bill", domain: "bill.com", why: "AP/AR automation" },
    ],
  },
];

const GENERIC_SEED: readonly Competitor[] = [
  { name: "HubSpot", domain: "hubspot.com", why: "Broad GTM / marketing suite" },
  { name: "Notion", domain: "notion.so", why: "Widely-advertised SaaS workspace" },
  { name: "Canva", domain: "canva.com", why: "Widely-advertised creative tool" },
];

// ----------------------------------------------------------------------------
// Small pure helpers (no throws).
// ----------------------------------------------------------------------------
function cleanDomain(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];
  return d && d.includes(".") ? d : undefined;
}

function brandKey(c: Competitor): string {
  const d = cleanDomain(c.domain);
  if (d) return d;
  return c.name.trim().toLowerCase();
}

function sameBrand(a: Competitor, b: Competitor): boolean {
  return brandKey(a) === brandKey(b);
}

function dedupe(list: Competitor[]): Competitor[] {
  const seen = new Set<string>();
  const out: Competitor[] = [];
  for (const c of list) {
    if (!c?.name?.trim()) continue;
    const k = brandKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: c.name.trim(), domain: cleanDomain(c.domain), why: c.why?.trim() || undefined });
  }
  return out;
}

/** Deterministic seed set by category keyword — never empty. */
function seedCompetitors(
  domain: string,
  firmo: { name?: string; description?: string; industry?: string } | undefined,
  cap: number,
  self: string,
): Competitor[] {
  const haystack = [
    domain,
    firmo?.name ?? "",
    firmo?.industry ?? "",
    firmo?.description ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const matched: Competitor[] = [];
  for (const seed of CATEGORY_SEEDS) {
    if (seed.keywords.some((kw) => haystack.includes(kw))) {
      matched.push(...seed.competitors);
    }
  }
  const pool = matched.length > 0 ? matched : [...GENERIC_SEED];
  return dedupe(pool)
    .filter((c) => brandKey(c) !== self)
    .slice(0, cap);
}

// ----------------------------------------------------------------------------
// PUBLIC: discoverCompetitors — domain → real advertising rivals. Never throws.
// ----------------------------------------------------------------------------
export async function discoverCompetitors(
  domain: string,
  opts: DiscoverCompetitorsOpts = {},
): Promise<Competitor[]> {
  const target = (domain ?? "").trim();
  if (!target) return [];

  const cap = Math.max(3, Math.min(opts.limit ?? 8, 12));
  const self = cleanDomain(target) ?? target.toLowerCase();

  // Firmographics ground both the LLM prompt and the seed fallback.
  const firmo =
    opts.firmographics ?? (await enrichCompany(target).catch(() => undefined));

  // 1) PRIMARY — the LLM knows the competitive set. Costs no new key.
  let out: Competitor[] = [];
  try {
    const r = await chatJSON<{ competitors?: Competitor[] }>({
      system:
        "You are a competitive-intelligence analyst. Given a company, list its REAL, " +
        "currently-operating DIRECT competitors — companies a buyer would evaluate as " +
        "alternatives. Prefer rivals that actively run paid ads. Use real brand names + " +
        "real root domains. No duplicates, and never the company itself.",
      user:
        `COMPANY: ${firmo?.name ?? target} (${target})\n` +
        `WHAT IT DOES: ${firmo?.description ?? "(infer from the domain)"}\n` +
        `CATEGORY: ${firmo?.industry ?? "(infer)"}\n` +
        `Return up to ${cap} competitors.`,
      schemaHint:
        '{ "competitors": [ { "name": string, "domain": string, "why": string } ] }',
      temperature: 0.5,
      maxTokens: 1200,
    });
    out = dedupe((r?.competitors ?? []).filter((c) => c?.name?.trim())).filter(
      (c) => brandKey(c) !== self,
    );
  } catch {
    // no key / bad JSON → fall through to grounding + seed
  }

  // 2) GROUND — Ocean lookalike enrichment (additive, key-gated, deduped).
  if (hasOrangeSliceKey() && out.length < cap) {
    try {
      const look = await discoverCompanies({
        keywords: firmo?.industry,
        limit: cap,
      });
      for (const a of look) {
        if (!a.company) continue;
        const cand: Competitor = { name: a.company, domain: a.domain };
        if (brandKey(cand) === self) continue;
        if (!out.some((c) => sameBrand(c, cand))) out.push(cand);
        if (out.length >= cap) break;
      }
    } catch {
      // additive only
    }
  }

  // 3) FALLBACK — deterministic seed so the pipeline is never empty.
  if (out.length === 0) {
    out = seedCompetitors(target, firmo, cap, self);
  }

  return dedupe(out).slice(0, cap);
}

// ----------------------------------------------------------------------------
// COMPETITOR ANALYSIS — for the top 2-3 discovered competitors, scrape their
// homepage (Supadata, graceful + rate-limit-guarded) and summarize with OpenAI
// into { whatTheyreBuilding, pros, cons }. NEVER throws and is FULLY optional:
//   - No Supadata key            → empty map (we have nothing to scrape).
//   - Scrape rate-limited / empty → that competitor is skipped (rate-limit stops
//                                   early to respect the free tier).
//   - No OpenAI key / bad JSON    → that competitor is skipped.
// Returned map is keyed by the competitor's lowercased name so callers can match
// it against an ad's `advertiser`.
// ----------------------------------------------------------------------------

/** Stable lookup key for a competitor name (matches an ad's `advertiser`). */
export function competitorNameKey(name: string): string {
  return (name ?? "").trim().toLowerCase();
}

function cleanStr(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = cleanStr(item, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Normalize/clamp a raw LLM analysis; null when there's nothing usable. */
function normalizeAnalysis(
  raw: Partial<CompetitorAnalysis> | null | undefined,
): CompetitorAnalysis | null {
  if (!raw) return null;
  const whatTheyreBuilding = cleanStr(raw.whatTheyreBuilding, 280);
  const pros = cleanList(raw.pros, 4, 120);
  const cons = cleanList(raw.cons, 4, 120);
  if (!whatTheyreBuilding && pros.length === 0 && cons.length === 0) return null;
  return { whatTheyreBuilding, pros, cons };
}

export async function analyzeCompetitors(
  competitors: Competitor[],
  opts: AnalyzeCompetitorsOpts = {},
): Promise<Map<string, CompetitorAnalysis>> {
  const out = new Map<string, CompetitorAnalysis>();
  if (!Array.isArray(competitors) || competitors.length === 0) return out;
  // Supadata is the scraping ground; without a key there's nothing to read, so
  // we omit analysis entirely rather than guessing.
  if (!supadataEnabled()) return out;

  const cap = Math.max(1, Math.min(opts.limit ?? 3, 3));
  // Only competitors with a real root domain can be scraped.
  const targets = competitors.filter((c) => cleanDomain(c.domain)).slice(0, cap);

  for (const c of targets) {
    const domain = cleanDomain(c.domain);
    if (!domain) continue;

    let scraped;
    try {
      scraped = await webScrape(`https://${domain}`);
    } catch {
      continue; // webScrape shouldn't throw, but stay defensive.
    }
    if (!scraped.ok || !scraped.data) {
      // Respect the free tier: if we're being throttled, stop scraping the rest.
      if (scraped.reason === "rate_limited") break;
      continue;
    }

    try {
      const r = await chatJSON<Partial<CompetitorAnalysis>>({
        system:
          "You are a competitive-intelligence analyst. From a competitor's homepage copy, " +
          "summarize concisely and factually. Do not invent features the copy doesn't support.",
        user:
          `COMPETITOR: ${c.name} (${domain})\n` +
          `WHY THEY'RE A RIVAL: ${c.why ?? "(direct competitor)"}\n\n` +
          `HOMEPAGE COPY (markdown, truncated):\n${scraped.data.markdown.slice(0, 4000)}\n\n` +
          "Return: whatTheyreBuilding = one tight sentence on the product + who it's for; " +
          "pros = up to 3 genuine strengths; cons = up to 3 likely weaknesses/gaps a challenger could exploit.",
        schemaHint:
          '{ "whatTheyreBuilding": string, "pros": string[], "cons": string[] }',
        temperature: 0.3,
        maxTokens: 500,
      });
      const analysis = normalizeAnalysis(r);
      if (analysis) out.set(competitorNameKey(c.name), analysis);
    } catch {
      // No OpenAI key / bad JSON → omit this competitor's analysis.
    }
  }

  return out;
}
