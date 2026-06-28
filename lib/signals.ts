// ============================================================================
// INTERCEPT — SIGNALS (find a warm buying trigger per prospect)
// ----------------------------------------------------------------------------
// `findSignal(prospect)` returns ONE recent, specific buying signal the outreach
// can be grounded in — funding, hiring, a launch, a job change, a tech move, a
// post. This is the moat: warm outbound replies at 15-25% vs ~3.4% generic.
//
// Strategy (graceful, layered):
//   1. PRIMARY — if EXA_API_KEY is set, search news/HN/reddit/blogs for a fresh
//      trigger about the company/person and KEEP THE REAL URL, then chatJSON
//      classifies it into a SignalType + one-line summary.
//   2. INFER — if no Exa result (or no key), chatJSON infers a sensible,
//      plausible signal from the prospect's profile (no fabricated URL).
//   3. FALLBACK — if the LLM is unavailable, a deterministic heuristic picks a
//      reasonable signal so every prospect still carries a warm angle.
//
// Returns `undefined` only when there is nothing to work with (no company). It
// NEVER throws — a missing signal must not block the pipeline, only lower a
// prospect's priority.
// ============================================================================

import { chatJSON } from "./openai";
import { searchThreads } from "./exa";
import type { Signal, SignalType, SourcedProspect } from "./contract";

const SIGNAL_TYPES: readonly SignalType[] = [
  "funding",
  "hiring",
  "news",
  "post",
  "job_change",
  "tech",
  "other",
];

// News/community domains where company triggers surface as linkable items.
const SIGNAL_DOMAINS = [
  "techcrunch.com",
  "businesswire.com",
  "prnewswire.com",
  "news.ycombinator.com",
  "reddit.com",
  "linkedin.com",
  "crunchbase.com",
  "theinformation.com",
];

function coerceType(raw: unknown): SignalType {
  const t = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  return (SIGNAL_TYPES as readonly string[]).includes(t)
    ? (t as SignalType)
    : "other";
}

/** Keyword heuristic to classify a headline when the LLM is unavailable. */
function classifyByKeywords(text: string): SignalType {
  const t = text.toLowerCase();
  if (/\b(raise[sd]?|funding|series [a-e]|seed round|valuation|led by)\b/.test(t)) return "funding";
  if (/\b(hiring|open role|headcount|we'?re hiring|joins? as|now hiring)\b/.test(t)) return "hiring";
  if (/\b(promoted|new role|joined|appointed|named .* (ceo|cto|vp|head))\b/.test(t)) return "job_change";
  if (/\b(launch|introducing|announc|unveil|releases?|ships?)\b/.test(t)) return "news";
  if (/\b(migrat|adopt|switch|stack|now using|built on)\b/.test(t)) return "tech";
  if (/\b(posted|shared|wrote|thread|on linkedin)\b/.test(t)) return "post";
  return "other";
}

/** Deterministic offline signal so a prospect is never left totally cold. */
function fallbackSignal(p: SourcedProspect): Signal {
  const company = p.company;
  const role = p.title ? `${p.title} ` : "";
  let summary: string;
  let type: SignalType;
  if (p.industry && /fintech|payments|bank/i.test(p.industry)) {
    type = "news";
    summary = `${company} is expanding in ${p.industry.toLowerCase()} — a timely moment to start a conversation.`;
  } else if (p.title && /sales|growth|revops|demand/i.test(p.title)) {
    type = "hiring";
    summary = `${company} is scaling its go-to-market team, suggesting active investment in pipeline.`;
  } else {
    type = "post";
    summary = `${role}at ${company} has been active on the topics ${company} cares about most.`;
  }
  return {
    type,
    summary,
    source: "inferred",
    foundAt: Date.now(),
  };
}

interface ClassifiedSignal {
  type?: string;
  summary?: string;
}

/**
 * Find a recent warm signal for a prospect.
 *
 * @param p A sourced prospect (company required; name/title optional).
 * @returns A Signal grounded in a real URL when Exa finds one, an inferred
 *          signal otherwise, or undefined only when there's no company to work
 *          with. Never throws.
 */
export async function findSignal(
  p: SourcedProspect,
): Promise<Signal | undefined> {
  const company = p?.company?.trim();
  if (!company) return undefined;

  // ---- Path 1: real, linkable trigger via Exa --------------------------------
  if (process.env.EXA_API_KEY) {
    try {
      const personClause = p.name ? `OR "${p.name}"` : "";
      const query =
        `"${company}" ${personClause} (raises OR funding OR hiring OR launches OR ` +
        `announces OR partnership OR "new role" OR acquires)`;
      const threads = await searchThreads({
        query,
        numResults: 6,
        includeDomains: SIGNAL_DOMAINS,
        type: "auto",
      });
      const hit = threads.find((t) => Boolean(t.url));
      if (hit) {
        let type: SignalType = classifyByKeywords(`${hit.title} ${hit.snippet}`);
        let summary = hit.title;
        // Refine with the LLM when available; keep the REAL url regardless.
        try {
          const classified = await chatJSON<ClassifiedSignal>({
            system:
              "You classify a news/web result into a B2B buying-signal type and " +
              "write ONE concise, specific sentence a salesperson could reference. " +
              "Do not add facts not present in the snippet.",
            user:
              `COMPANY: ${company}\nTITLE: ${hit.title}\nSNIPPET: ${hit.snippet}\n` +
              `URL: ${hit.url}\n\nTypes: ${SIGNAL_TYPES.join(", ")}.`,
            schemaHint: '{ "type": string, "summary": string }',
            temperature: 0.3,
            maxTokens: 200,
          });
          type = coerceType(classified?.type);
          if (classified?.summary?.trim()) summary = classified.summary.trim();
        } catch {
          // LLM unavailable — keep the keyword classification + title summary.
        }
        let source: string | undefined;
        try {
          source = new URL(hit.url).hostname.replace(/^www\./, "");
        } catch {
          source = "exa";
        }
        return {
          type,
          summary,
          url: hit.url,
          source,
          foundAt: hit.publishedDate ? Date.parse(hit.publishedDate) || Date.now() : Date.now(),
        };
      }
    } catch {
      // Exa error — fall through to inference.
    }
  }

  // ---- Path 2: inferred signal from the profile via the LLM ------------------
  try {
    const inferred = await chatJSON<ClassifiedSignal>({
      system:
        "You are a GTM researcher. Given a prospect, infer ONE plausible, recent " +
        "buying signal that would make warm outreach relevant right now. Be " +
        "specific but do not fabricate exact figures, dates, or fake URLs.",
      user:
        `COMPANY: ${company}\nPERSON: ${p.name ?? "n/a"}\nTITLE: ${p.title ?? "n/a"}\n` +
        `INDUSTRY: ${p.industry ?? "n/a"}\nLOCATION: ${p.location ?? "n/a"}\n\n` +
        `Pick the most likely signal type from: ${SIGNAL_TYPES.join(", ")}.`,
      schemaHint: '{ "type": string, "summary": string }',
      temperature: 0.5,
      maxTokens: 200,
    });
    if (inferred?.summary?.trim()) {
      return {
        type: coerceType(inferred.type),
        summary: inferred.summary.trim(),
        source: "inferred",
        foundAt: Date.now(),
      };
    }
  } catch {
    // No key / failure — deterministic fallback below.
  }

  // ---- Path 3: deterministic offline fallback --------------------------------
  return fallbackSignal(p);
}
