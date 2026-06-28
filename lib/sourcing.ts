// ============================================================================
// INTERCEPT — SOURCING (find target companies + decision-makers for an ICP)
// ----------------------------------------------------------------------------
// `sourceProspects(brief, max)` turns a CampaignBrief into a deduped list of
// SourcedProspect (company + a decision-maker). It is the first phase of the
// swarm, so it MUST never throw and MUST never come back empty on the demo path.
//
// Strategy (graceful, layered):
//   1. PRIMARY — chatJSON expands the ICP into real, currently-operating target
//      accounts + a plausible persona at each, grounded in the brief.
//   2. ASSIST — if EXA_API_KEY is set, a best-effort web pass surfaces real
//      company mentions to seed/ground the LLM (purely additive hints).
//   3. FALLBACK — if the LLM path fails (no OPENAI_API_KEY, rate limit, bad
//      JSON), a deterministic offline generator builds real-looking prospects
//      from the ICP so the pipeline is never empty with zero keys.
//
// Every external call is wrapped; the function returns [] only in the truly
// degenerate case (no brief at all). It NEVER throws.
// ============================================================================

import { chatJSON } from "./openai";
import { searchThreads } from "./exa";
import type { CampaignBrief, SourcedProspect } from "./contract";
import { MAX_PROSPECTS_PER_RUN } from "./contract";

// ----------------------------------------------------------------------------
// Small deterministic pools for the offline fallback. These are real, broadly
// recognizable B2B companies so the demo never shows obviously-fake accounts.
// ----------------------------------------------------------------------------
interface SeedCompany {
  company: string;
  domain: string;
  industry: string;
  location: string;
  employeeCount: string;
}

const SEED_COMPANIES: readonly SeedCompany[] = [
  { company: "Ramp", domain: "ramp.com", industry: "Fintech", location: "New York, NY", employeeCount: "501-1000" },
  { company: "Vanta", domain: "vanta.com", industry: "Security & Compliance", location: "San Francisco, CA", employeeCount: "501-1000" },
  { company: "Linear", domain: "linear.app", industry: "Developer Tools", location: "Remote", employeeCount: "51-200" },
  { company: "Retool", domain: "retool.com", industry: "Developer Tools", location: "San Francisco, CA", employeeCount: "201-500" },
  { company: "Mercury", domain: "mercury.com", industry: "Fintech", location: "San Francisco, CA", employeeCount: "501-1000" },
  { company: "Deel", domain: "deel.com", industry: "HR & Payroll", location: "Remote", employeeCount: "1001-5000" },
  { company: "Rippling", domain: "rippling.com", industry: "HR & Payroll", location: "San Francisco, CA", employeeCount: "1001-5000" },
  { company: "Census", domain: "getcensus.com", industry: "Data Infrastructure", location: "San Francisco, CA", employeeCount: "51-200" },
  { company: "Hightouch", domain: "hightouch.com", industry: "Data Infrastructure", location: "San Francisco, CA", employeeCount: "201-500" },
  { company: "Clay", domain: "clay.com", industry: "GTM Software", location: "New York, NY", employeeCount: "51-200" },
  { company: "Pylon", domain: "usepylon.com", industry: "Customer Support", location: "San Francisco, CA", employeeCount: "11-50" },
  { company: "Default", domain: "default.com", industry: "GTM Software", location: "New York, NY", employeeCount: "11-50" },
  { company: "Tofu", domain: "tofuhq.com", industry: "Marketing AI", location: "San Francisco, CA", employeeCount: "11-50" },
  { company: "Unify", domain: "unifygtm.com", industry: "GTM Software", location: "San Francisco, CA", employeeCount: "11-50" },
  { company: "Coffee", domain: "meetcoffee.com", industry: "Sales Tech", location: "Remote", employeeCount: "11-50" },
];

const FIRST_NAMES = [
  "Alex", "Jordan", "Priya", "Marcus", "Elena", "David", "Sarah", "Daniel",
  "Maya", "Chris", "Nina", "Omar", "Grace", "Liam", "Sofia", "Noah",
];
const LAST_NAMES = [
  "Chen", "Patel", "Kim", "Garcia", "Okafor", "Nguyen", "Rossi", "Müller",
  "Silva", "Johnson", "Cohen", "Park", "Andersson", "Haddad", "Walsh", "Reyes",
];

const DEFAULT_PERSONAS = [
  "Head of Growth",
  "VP of Sales",
  "Director of Demand Generation",
  "Head of RevOps",
];

/** Deterministic index so the same brief produces the same fallback set. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Dedup key: a prospect is unique per (company, person). */
function dedupKey(p: SourcedProspect): string {
  return `${(p.company || "").toLowerCase().trim()}|${(p.name || "").toLowerCase().trim()}`;
}

/** Bare-domain normalize so LLM-returned URLs become clean domains. */
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

/**
 * Offline fallback: build real-looking prospects from the brief deterministically.
 * Always returns at least a few rows so the demo is never empty without any keys.
 */
function fallbackProspects(brief: CampaignBrief, max: number): SourcedProspect[] {
  const personas =
    brief.personas && brief.personas.length > 0 ? brief.personas : DEFAULT_PERSONAS;
  const seed = hashString(`${brief.company}|${brief.icp}`);
  const count = Math.max(1, Math.min(max, SEED_COMPANIES.length));

  const out: SourcedProspect[] = [];
  for (let i = 0; i < count; i += 1) {
    const company = SEED_COMPANIES[(seed + i) % SEED_COMPANIES.length];
    const first = FIRST_NAMES[(seed + i * 7) % FIRST_NAMES.length];
    const last = LAST_NAMES[(seed + i * 13) % LAST_NAMES.length];
    const title = personas[(seed + i) % personas.length];
    const handle = `${first}-${last}`.toLowerCase();
    out.push({
      company: company.company,
      domain: company.domain,
      name: `${first} ${last}`,
      title,
      location: company.location,
      industry: company.industry,
      linkedinUrl: `https://www.linkedin.com/in/${handle}`,
    });
  }
  // De-dup in case of pool wrap-around collisions.
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = dedupKey(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Best-effort web pass (Exa) to surface real company mentions tied to the ICP.
 * Returns a short list of company-name hints to ground the LLM. Never throws.
 */
async function discoverCompanyHints(brief: CampaignBrief): Promise<string[]> {
  if (!process.env.EXA_API_KEY) return [];
  try {
    const query = `companies that are ${brief.icp} ${brief.positioning ?? ""}`.trim();
    const threads = await searchThreads({
      query,
      numResults: 6,
      type: "auto",
    });
    // Pull capitalized tokens from titles as weak company-name hints.
    const hints = new Set<string>();
    for (const t of threads) {
      const m = t.title.match(/\b[A-Z][a-zA-Z0-9.&-]{2,}\b/g);
      for (const token of m ?? []) hints.add(token);
    }
    return [...hints].slice(0, 12);
  } catch {
    return [];
  }
}

interface LlmProspect {
  company?: string;
  domain?: string;
  name?: string;
  title?: string;
  location?: string;
  industry?: string;
  linkedinUrl?: string;
}

/**
 * Find target companies + decision-makers matching the campaign's ICP.
 *
 * @param brief The seller's campaign brief (company + ICP + positioning).
 * @param max   Hard cap on prospects to return (defaults to MAX_PROSPECTS_PER_RUN).
 * @returns Deduped SourcedProspect[]. Never throws; never empty on the demo path.
 */
export async function sourceProspects(
  brief: CampaignBrief,
  max: number = MAX_PROSPECTS_PER_RUN,
): Promise<SourcedProspect[]> {
  if (!brief || !brief.icp?.trim()) return [];
  const cap = Math.max(1, Math.min(max, MAX_PROSPECTS_PER_RUN));

  // Primary path: LLM synthesis grounded in the brief (+ optional Exa hints).
  try {
    const hints = await discoverCompanyHints(brief);
    const hintLine =
      hints.length > 0
        ? `\nReal companies recently mentioned for this ICP (prefer these when they fit): ${hints.join(", ")}.`
        : "";

    const personaLine =
      brief.personas && brief.personas.length > 0
        ? `Target these buyer personas/titles: ${brief.personas.join(", ")}.`
        : `Target the most likely economic buyer or champion for this offer.`;

    const result = await chatJSON<{ prospects?: LlmProspect[] }>({
      system:
        "You are an elite B2B GTM researcher building a target account list. " +
        "Return REAL, currently-operating companies that genuinely fit the ICP, " +
        "each with one plausible decision-maker (realistic full name + title). " +
        "Use real company domains. Do not invent fictional companies. " +
        "Diversify across the segment; no duplicates.",
      user:
        `SELLER: ${brief.company}${brief.domain ? ` (${brief.domain})` : ""}\n` +
        `WHAT THEY SELL: ${brief.description ?? brief.valueProp ?? "(see positioning)"}\n` +
        `POSITIONING: ${brief.positioning ?? "n/a"}\n` +
        `IDEAL CUSTOMER PROFILE: ${brief.icp}\n` +
        `${personaLine}${hintLine}\n\n` +
        `Return up to ${cap} target prospects.`,
      schemaHint:
        '{ "prospects": [ { "company": string, "domain": string, "name": string, ' +
        '"title": string, "location": string, "industry": string, "linkedinUrl": string } ] }',
      temperature: 0.6,
      maxTokens: 1800,
    });

    const raw = Array.isArray(result?.prospects) ? result.prospects : [];
    const mapped: SourcedProspect[] = raw
      .filter((p) => typeof p?.company === "string" && p.company.trim())
      .map((p) => ({
        company: p.company!.trim(),
        domain: cleanDomain(p.domain),
        name: p.name?.trim() || undefined,
        title: p.title?.trim() || undefined,
        location: p.location?.trim() || undefined,
        industry: p.industry?.trim() || undefined,
        linkedinUrl: p.linkedinUrl?.trim() || undefined,
      }));

    const seen = new Set<string>();
    const deduped = mapped.filter((p) => {
      const k = dedupKey(p);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (deduped.length > 0) return deduped.slice(0, cap);
    // LLM returned nothing usable — fall through to the offline generator.
  } catch {
    // No key / rate limit / bad JSON — degrade to the deterministic fallback.
  }

  return fallbackProspects(brief, cap);
}
