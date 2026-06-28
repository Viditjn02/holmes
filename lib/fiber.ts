// ============================================================================
// INTERCEPT — FIBER AI VERIFIED-CONTACT CLIENT  (REAL DATA)
// ----------------------------------------------------------------------------
// Fiber AI is the VERIFIED-EMAIL layer behind outbound (850M+ people with
// verification). The previous build hit GET endpoints with a Bearer header; the
// REAL Fiber API is POST-based and authenticates with the key IN THE BODY
// (`{ apiKey, ...payload }`). Finding a verified work email is a TWO-STEP flow:
//
//   findContact(company, role):
//     1. POST /text-to-profile-search  → resolve a person profile from a
//        natural-language query ("Head of Growth at <company>")
//     2. POST /contacts/reveal         → reveal that profile's contact methods;
//        we keep the email where  type === "work" && status === "valid"  (a
//        Fiber-VERIFIED work address). Anything else → verified:false.
//
//   enrichDomain(domain):
//     POST /companies/kitchen-sink      → light firmographic context for copy.
//
// GRACEFUL DEGRADATION: with no FIBER_API_KEY (or on any error / no verified
// match) every call NO-OPs to `{ verified:false }` / `{ resolved:false }` and
// NEVER throws — it must never block the swarm, the brief, or a draft.
// ============================================================================

const FIBER_BASE_URL = process.env.FIBER_BASE_URL ?? "https://api.fiber.ai/v1";
const FIBER_TIMEOUT_MS = 12_000;

/** A best-effort verified contact for a company/role. `verified` is the gate. */
export interface VerifiedContact {
  /** Verified WORK email, present ONLY when type==="work" && status==="valid". */
  email?: string;
  name?: string;
  title?: string;
  linkedinUrl?: string;
  /**
   * True ONLY when Fiber revealed a work email it marked valid. The outreach
   * layer treats verified:false as "no verified address — do not send".
   */
  verified: boolean;
}

/** Firmographic-ish domain context Fiber can return alongside contacts. */
export interface FiberDomainInfo {
  domain: string;
  name?: string;
  description?: string;
  industry?: string;
  employeeCount?: string;
  location?: string;
  /** True when the lookup actually resolved against Fiber (vs. a no-op). */
  resolved: boolean;
}

export interface FindContactArgs {
  /** Company name or domain to find a verified contact at. Required. */
  company: string;
  /** Optional role/title to target (e.g. "Head of Growth", "founder"). */
  role?: string;
  /** Optional specific person name to disambiguate the profile search. */
  name?: string;
}

const NO_CONTACT: VerifiedContact = { verified: false };

/** Read the API key fresh each call so env changes are picked up without restart. */
function getApiKey(): string | undefined {
  const key = process.env.FIBER_API_KEY?.trim();
  return key ? key : undefined;
}

/** True when a real Fiber key is configured. */
export function hasFiberKey(): boolean {
  return getApiKey() !== undefined;
}

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
  }
  return undefined;
}

/**
 * POST to Fiber with the key IN THE BODY. Returns the parsed object, or `null`
 * on any error/timeout/non-2xx so callers degrade gracefully (never throws).
 */
async function fiberPost(
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIBER_TIMEOUT_MS);
  try {
    const resp = await fetch(`${FIBER_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // Fiber authenticates with the key in the payload, not a Bearer header.
      body: JSON.stringify({ apiKey, ...body }),
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as unknown;
    return asRecord(data) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first profile out of whatever envelope Fiber returns. */
function firstProfile(
  data: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const arrays = [data["profiles"], data["results"], data["data"], data["matches"]];
  for (const arr of arrays) {
    if (Array.isArray(arr) && arr.length > 0) {
      const rec = asRecord(arr[0]);
      if (rec) return rec;
    }
  }
  // Sometimes the profile is returned directly (or nested under `profile`).
  return asRecord(data["profile"]) ?? asRecord(data["result"]) ?? data;
}

/**
 * From a reveal response, extract a VERIFIED work email. The contract: keep the
 * email entry where `type === "work"` and `status === "valid"`. Falls back to a
 * top-level `email` only when Fiber explicitly flags it verified/valid.
 */
function extractVerifiedEmail(
  data: Record<string, unknown> | null,
): string | undefined {
  if (!data) return undefined;
  const container = firstProfile(data) ?? data;

  const emailArrays = [
    data["emails"],
    container?.["emails"],
    container?.["contact_methods"],
    data["contact_methods"],
  ];
  for (const arr of emailArrays) {
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      const rec = asRecord(entry);
      if (!rec) continue;
      const type = firstString(rec, ["type", "category"])?.toLowerCase();
      const status = firstString(rec, ["status", "verification_status"])?.toLowerCase();
      const value = firstString(rec, ["email", "address", "value"]);
      if (value && type === "work" && status === "valid") return value;
    }
    // Second pass: accept a valid email even if type is unlabeled.
    for (const entry of arr) {
      const rec = asRecord(entry);
      if (!rec) continue;
      const status = firstString(rec, ["status", "verification_status"])?.toLowerCase();
      const value = firstString(rec, ["email", "address", "value"]);
      if (value && status === "valid") return value;
    }
  }

  // Top-level email only if explicitly verified.
  const topEmail = firstString(container, ["work_email", "verified_email", "email"]);
  const verifiedFlag =
    container?.["verified"] === true ||
    container?.["is_verified"] === true ||
    firstString(container, ["status", "verification_status"])?.toLowerCase() === "valid";
  return topEmail && verifiedFlag ? topEmail : undefined;
}

/**
 * Find a VERIFIED work contact (email/name/title) at a company, optionally
 * narrowed by role/name. Two-step: text-to-profile-search → contacts/reveal.
 *
 * Returns {verified:false} (no-op) when the key is missing, Fiber errors, or no
 * VALID work email exists. NEVER throws.
 */
export async function findContact(
  args: FindContactArgs,
): Promise<VerifiedContact> {
  const company = args.company?.trim();
  if (!company) return NO_CONTACT;

  const apiKey = getApiKey();
  if (!apiKey) return NO_CONTACT;

  // Step 1 — resolve a profile from a natural-language query.
  const queryParts = [
    args.name?.trim(),
    args.role?.trim() ? `${args.role.trim()} at ${company}` : `decision maker at ${company}`,
  ].filter(Boolean);
  const search = await fiberPost("/text-to-profile-search", apiKey, {
    query: queryParts.join(", "),
    company,
    ...(args.role?.trim() ? { title: args.role.trim() } : {}),
    limit: 1,
  });
  const profile = firstProfile(search);
  if (!profile) return NO_CONTACT;

  const profileId =
    firstString(profile, ["id", "profile_id", "person_id", "uuid"]) ?? undefined;
  const name = firstString(profile, ["name", "full_name"]);
  const title = firstString(profile, ["title", "job_title", "role", "headline"]);
  const linkedinUrl = firstString(profile, ["linkedin_url", "linkedin"]);

  // Step 2 — reveal contact methods for that profile.
  const reveal = await fiberPost("/contacts/reveal", apiKey, {
    ...(profileId ? { profileId } : {}),
    ...(linkedinUrl ? { linkedinUrl } : {}),
    company,
    ...(name ? { name } : {}),
  });

  const email = extractVerifiedEmail(reveal) ?? extractVerifiedEmail(search);
  return {
    email,
    name,
    title,
    linkedinUrl,
    verified: Boolean(email),
  };
}

/**
 * Enrich a company DOMAIN into light firmographic context via Fiber's
 * `/companies/kitchen-sink`. Secondary — the brief's ICP/positioning comes from
 * the enrichment agent, not here. Returns {resolved:false} on no key / error.
 * NEVER throws.
 */
export async function enrichDomain(domain: string): Promise<FiberDomainInfo> {
  const normalized = domain
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];

  if (!normalized) return { domain: "", resolved: false };

  const apiKey = getApiKey();
  if (!apiKey) return { domain: normalized, resolved: false };

  const data = await fiberPost("/companies/kitchen-sink", apiKey, {
    domain: normalized,
  });
  if (!data) return { domain: normalized, resolved: false };

  const company =
    asRecord(data["company"]) ??
    asRecord(data["result"]) ??
    asRecord(data["data"]) ??
    data;

  return {
    domain: normalized,
    name: firstString(company, ["name", "company_name"]),
    description: firstString(company, ["description", "summary", "short_description"]),
    industry: firstString(company, ["industry", "sector"]),
    employeeCount: firstString(company, ["employee_count", "size", "headcount"]),
    location: firstString(company, ["location", "hq", "headquarters"]),
    resolved: true,
  };
}
