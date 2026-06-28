# INTERCEPT — Prioritized OSS Integration Plan

> AI-native GTM chat platform. This plan harvests open-source IP into INTERCEPT's Convex + Next.js 15 stack, ordered by leverage. The headline win is **free, real data** — replacing paid enrichment/scraping vendors (`lib/orangeslice.ts`, `lib/fiber.ts`) with permissively-licensed, portable algorithms.

---

## ⛔ License Firewall — DO-NOT-reuse-source (read first)

| Repo | License | Ruling |
|---|---|---|
| **Shepherd** (`shipshapecode/shepherd` v15.2.2) | **AGPL-3.0 / commercial** | **DO NOT copy source.** AGPL is viral and network-served — it would force INTERCEPT's SaaS source open. Reimplement its `attachTo`/`advanceOn`/`beforeShowPromise` tour UX from scratch on shadcn + floating-ui (both MIT), driven by the OnboardJS engine. APIs/ideas are not copyrightable; the code is. (Alternatively buy a commercial license — not recommended.) |

**Attribution rider (not viral, but mandatory):**
- **crawl4ai** (`unclecode/crawl4ai`, Apache-2.0) carries an attribution rider. Any port of its code/prompts must ship a `NOTICE` credit line. No source-disclosure obligation.

**Everything else harvested is MIT or Apache-2.0 — safe to port.** No other AGPL/GPL anywhere in the harvest.

---

# TIER 0 — THE FREE-REAL-DATA WIN (do this first)

This tier retires our paid data dependency. After it lands, person-email enrichment and company-page scraping cost us **zero subscription dollars** and run on first-party algorithms we control.

## 0.1 — email-sleuth → free email find + verify  ⭐ HIGHEST VALUE
- **Source:** `github.com/buyukakyuz/email-sleuth` · **License: MIT** ✅
- **Attribution:** "Email discovery/verification algorithm ported from email-sleuth (MIT), © buyukakyuz." (retain MIT header on any verbatim-ported file)
- **What we get:** name + domain → pattern generation → DNS MX → SMTP `RCPT TO` probe → catch-all detection → confidence score. The full paid-enrichment loop with no vendor.

| Piece | Rust source | INTERCEPT file | TS adaptation |
|---|---|---|---|
| **A. Pattern generation** | `src/utils/patterns.rs::generate_email_patterns` (22–122) + `sanitize_name_part` (9–16) | **add** `lib/emailFinder.ts` | Drop-in. ~40 lines. Build candidate set into a `Set<string>` (`john.doe`, `jdoe`, `john_doe`, reversed, initials…). Validate each against regex `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b` (from `config/mod.rs:109`). |
| **B. DNS MX resolution** | `src/utils/dns.rs::resolve_mail_server` (78–155) + `resolve_a_record_fallback` (158–214) | **add** `lib/smtpVerify.ts` | Node built-in `dns/promises`: `resolveMx(domain)` → sort by `priority` (lowest wins) → fallback `resolve4`. ~25 lines. Runs fine inside a Convex `"use node"` action (DNS is not port-blocked). |
| **C. SMTP mailbox probe** | `src/utils/smtp/client.rs::verify_email` (144), `try_connection` (254), `perform_catch_all_check` (457–501), `evaluate_smtp_response` (504), rejection-phrase list (541–556) | **add** external worker + thin client in `lib/smtpVerify.ts` | Node `net.Socket` (or `nodemailer` SMTP) → port 25: `EHLO`/`MAIL FROM`/`RCPT TO`, **never `DATA`** (nothing is delivered). Parse 3-digit codes: `2xx`=exists, `5xx`+phrase=dead, `4xx`=greylist→retry. Port catch-all probe + rejection-phrase list verbatim. |
| **D. Confidence scoring** | `src/core/sleuth.rs::calculate_initial_confidence` (813–833), `is_generic_prefix` (912), `check_name_in_email` (899); thresholds `config/mod.rs:131–132`; generic-prefix set `config/mod.rs:68–102` | **add** `lib/emailFinder.ts` | Pure integer math, ~30 lines. Base 1; +1 MX exists (else hard 0); +1 name-in-local-part; −3 generic prefix; SMTP boost +7 valid-non-catch-all / +1 catch-all / −10 rejected. Accept ≥4 (≥7 for role accounts). Copy the generic-prefix list (`info, contact, sales, support…`) verbatim. |

- 🚩 **PORT-25 DEPLOYMENT CAVEAT (load-bearing):** Outbound port 25 is **blocked on Convex actions, Vercel, and AWS Lambda.** Piece C cannot run in Convex.
  - **Chosen approach (real data):** deploy a tiny dedicated worker (Fly.io / Railway / $5 VPS, unblocked port 25) exposing `POST /verify {email}` → `{exists, catchAll, code}`. Call it from Convex through `lib/safeFetch.ts`. `lib/smtpVerify.ts` is the client wrapper.
  - **Fallback (no worker yet):** run Pieces A+B+D in Convex, skip live SMTP, emit "likely" confidence from MX-exists + pattern + catch-all-via-web only.
- **Wire-in:** in `convex/agents/enrich.ts` (currently `enrichCompany` from `lib/orangeslice.ts`) and `convex/agents/detective.ts`, replace paid OrangeSlice/Fiber person-email lookups with `emailFinder.findEmails(first,last,domain)` → ranked candidates → `smtpVerify` → keep score ≥ 4. **This retires the paid email layer.**

## 0.2 — crawl4ai → LLM scraping to structured JSON
- **Source:** `github.com/unclecode/crawl4ai` · **License: Apache-2.0 + attribution rider** ⚠️
- **Attribution (MANDATORY):** add a **`NOTICE`** file: *"This product includes software developed by UncleCode … as part of the Crawl4AI project (https://github.com/unclecode/crawl4ai)."*
- **What we get:** free replacement for paid company-page scraping/enrichment. Reusable IP is the **approach + prompts**, which drop onto our existing `lib/openai.ts` `chatJSON`.

| Piece | Python source | INTERCEPT file | TS adaptation |
|---|---|---|---|
| **E. Clean HTML → LLM → schema JSON** | `extraction_strategy.py::LLMExtractionStrategy` (533–1040), `extract` (641–772); prompts `prompts.py` `PROMPT_EXTRACT_SCHEMA_WITH_INSTRUCTION` (108–143), `PROMPT_EXTRACT_INFERRED_SCHEMA` (145–200), `PROMPT_FILTER_CONTENT` (202–246) | **add** `lib/scrape.ts` → `scrapeToJSON(url, schema|instruction)` | Fetch via `lib/safeFetch.ts`, strip to text, chunk by token budget w/ overlap, send through existing `chatJSON` with `response_format: json_object`. Simpler than crawl4ai's `<blocks>` XML parsing since we already force JSON. Copy the prompt bodies + chunking helper verbatim; keep the 1–5 self-score "Quality Reflection" step. |
| **F. Learn-schema-once, CSS-extract-many** | `JsonCssExtractionStrategy` (1043+), `generate_schema`/`_build_schema_prompt` (1628), prompt `JSON_SCHEMA_BUILDER` (248–307), `_extract_item` (1241) | **add** `lib/scrape.ts` → `learnSiteSchema(url)` / `extractWithSchema(html, schema)` | One LLM call produces a reusable CSS-selector schema `{name, baseSelector, fields[]}`; persist in Convex; apply to later same-site pages with **`cheerio` and zero LLM cost**. Map `type: text|attribute|nested|list|regex` to `.text()`/`.attr()`/`.find()`. Big saver on directory/community crawls. |

- **Wire-in:** repoint the `ScrapeResult`/`enrichCompany` path in `convex/agents/enrich.ts` and the community scraping in `convex/agents/detective.ts` at `lib/scrape.ts` instead of `lib/orangeslice.ts`.

## 0.3 — website-email-extractor-rust → SKIP as data, mirror schema only
- **Source:** `github.com/tomba-io/website-email-extractor-rust` · **License: MIT** ✅
- **Verdict:** **Do NOT port its fetch path** — despite the name it is a thin wrapper around the **paid Tomba Domain Search API** (`api.tomba.io/v1/domain-search`, needs `TOMBA_KEY`/`TOMBA_SECRET`). Using it just swaps one paid vendor for another.
- **Only reuse:** the contact **output schema** (`main.rs::email_json`, 226–235). Mirror these field names in `lib/contract.ts` for the enriched-contact shape so downstream agents stay consistent: `email, first_name, last_name, full_name, position, department, seniority, type (personal|generic), score, verification_status, linkedin, twitter, phone_number, country, sources_count`.

---

# TIER 1 — SALES / OUTBOUND DEPTH (the unique beat)

> "Before INTERCEPT sends a single email, it builds a psychological twin of the prospect and simulates ~15 outreach variants against it, then sends only the statistically best one — objection playbook pre-loaded for the reply agent."

## 1.1 — ai-sales-agent-simulator → psychological twin + Monte-Carlo optimization
- **Source:** `github.com/ndpvt-web/ai-sales-agent-simulator` (HappyCapy) · **License: MIT** ✅ · plain Node ESM, ~10 small files, clean Convex-action port.
- **Attribution:** keep the MIT header on any `src/*` file copied verbatim.

| Piece | JS source | INTERCEPT file | TS adaptation |
|---|---|---|---|
| **1A. Psych profiler** | `src/profiler/profile-builder.js::buildProfile`, `PROFILE_SCHEMA`, prompt pair (336–363) | `convex/agents/enrich.ts` (+`profiles`/lead field in `convex/schema.ts`) | One JSON-schema-constrained call: scraped/Exa text → Big Five + style + painPoints + persuasionTriggers + objectionPatterns. Use our `lib/openai.ts`/`lib/gemini.ts` instead of their gateway. Schema + prompt are the load-bearing IP. |
| **1B. Digital twin** | `src/twin-engine/twin-builder.js::createTwin`, `buildSystemPrompt`, `personalityDescriptors`, `deriveTemperature`, `communicationStyleDirective` | **add** `convex/agents/twin.ts` | Deterministic profile → role-play system prompt + derived temperature (0.4–0.95). Reuse twin prompt as grounding block in `convex/agents/reply.ts` to predict prospect reactions. |
| **1C. LHS strategy gen** | `src/strategy-engine/strategy-gen.js::lhsSample`, `generateStrategies`, `buildSalesAgent`; dimension maps in `templates/email-strategies.js` | `convex/outreach.ts` (+ a constants module) | Latin Hypercube Sampling stratifies across openingStyle × valueFrame × urgency × tone × objectionHandling → K diverse variants (use 8–20, not their 50–100). The instruction maps are a ready-made B2B copy-directive library. |
| **1D. Simulate + rank + analyze** | `src/simulator/email-sim.js::runEmailSim`/`evaluateExchange`; `sim-runner.js::runBatch` (bounded worker pool, no p-limit); `analyzer/result-analyzer.js::analyze` | `convex/outreach.ts` + **add**/reuse `convex/run.ts` | LLM-as-evaluator scores each exchange (engagement, meetingAcceptance, trust, objections, outcome). Pick top variant pre-send; persist playbook + objection map on the lead. `evaluateExchange`'s metric schema = our reply-quality scorer. Respect Convex action time limits: small N + worker-pool, or fan out via scheduler. |

- **Multi-model diversity trick:** replicate `src/gateway/ai-gateway.js::randomModel` across `lib/openai.ts` + `lib/gemini.ts` so twin/judge ≠ writer model (cuts self-grading bias).

## 1.2 — b2b-sdr-agent-template → pipeline + cadence skeleton (port SPEC, not code)
- **Source:** `github.com/iPythoning/b2b-sdr-agent-template` (PulseAgent) · **License: MIT** ✅ · markdown-driven OpenClaw agent → we port the *design*; attribution is courtesy-only.

| Piece | Source file | INTERCEPT file | Adaptation |
|---|---|---|---|
| **2A. 10-stage SDR state machine** | `workspace/AGENTS.md` | status enum → `convex/schema.ts`; stage routing → `convex/agents/router.ts`; Day 1/3/7/14 → `convex/outreach.ts` | Lead status enum (`new/contacted/interested/quote_sent/negotiating/meeting_set/nurture/closed_won/closed_lost/email_sent/email_replied`) + explicit transitions replace ad-hoc prompting. |
| **2B. Heartbeat cron** | `workspace/HEARTBEAT.md`; `deploy/generate-config.sh:160` | `convex/crons.ts` | One dispatcher tick every 15–30m reading "what's due now" (vs 14 cron entries). Port stalled-lead (>5 business days), quote-tracking (3 days), no-reply channel auto-switch (3 days). |
| **2C. Dynamic ICP scoring** | `workspace/USER.md` + `AGENTS.md` | `convex/schema.ts` (`icpScore`, `leadTier`) + helper from `convex/agents/enrich.ts` (initial) & `convex/agents/reply.ts`/`convex/monitor.ts` (deltas) | Weighted base (Volume 30 / Match 25 / Region 20 / Payment 15 / Authority 10) + behavioral deltas (reply +1, asks quote +2, no-reply-7d −1, removal −3…) capped ±5/day. ICP ≥ 7 auto-flags hot lead. |
| **2D. Memory-compaction prompt** | `scripts/proactive-summary.mjs::COMPRESSION_PROMPT` | helper in `lib/openai.ts` or pre-step in `convex/agents/reply.ts` | Dual thresholds (50% background extract, 65% blocking compress) on a cheap model; forces verbatim preservation of numbers/prices/BANT/commitments. Pairs with `lib/gbrain.ts`. |
| **2E. Humanization / send-pacing** | `workspace/SOUL.md` + AGENTS.md timezone table | `convex/outreach.ts` send scheduler | 3–90s jittered delays + timezone-gated send windows (09:00–17:00 local, 12-row market→TZ table is copy-paste config) to avoid spammy bursts. |

---

# TIER 2 — VIDEO / CONTENT (AI ad factory)

## 2.1 — ViMax → agentic idea→video pipeline
- **Source:** `github.com/HKUDS/ViMax` · **License: MIT** ✅ · clean async, resume-on-rerun.
- **Attribution:** keep MIT header on verbatim prompt/contract ports.

| Piece | Python source | INTERCEPT file | Adaptation |
|---|---|---|---|
| **1. Orchestration** | `pipelines/idea2video_pipeline.py::Idea2VideoPipeline.__call__` (204–252) | Convex durable workflow: one action per stage (`developStory`/`extractCharacters`/`writeScenes`/`renderScene`/`concat`) → `videoProjects`/`scenes` tables | Their disk-cache guard (`os.path.exists`) → "skip if doc already has this field" = free idempotency/retries. |
| **2. Screenwriter** | `agents/screenwriter.py` prompts (13–104) | **add** `convex/prompts/screenwriter.ts` constant | Lift cinematic prompts verbatim ("Show Don't Tell", filmable descriptions); reframe story → ad brief. Use Anthropic SDK JSON schema instead of LangChain/Pydantic. |
| **3. Storyboard artist** ⭐ | `agents/storyboard_artist.py::design_storyboard`/`decompose_visual_description` (prompts 15–53, 73–110); `validate_char_idxs` (263–276) | **add** `convex/agents/storyboard.ts` | First-frame/last-frame/motion decomposition + large/medium/small variation taxonomy = the trick that drives keyframe-conditioned models. Feed `ff_desc`/`lf_desc` as the two conditioning images to Veo. Copy the `@retry` re-ask validation pattern. |
| **4. Data contracts** | `interfaces/shot_description.py`, `character.py`, `scene.py`, `camera.py` | `convex/schema.ts` `defineTable` for `scenes`/`shots`/`characters` | Near-1:1 translate (`cam_idx`, `visual_desc`, `ff_desc`/`lf_desc`, `motion_desc`, `variation_type`). |
| **5. Pluggable render backend** | `tools/protocols.py` (`VideoGenerator`), `tools/render_backend.py::RenderBackend.from_config`, `tools/video_generator_veo_google_api.py` | **add** `convex/render/backend.ts` | Satisfy `generate_single_video(prompt, reference_image_paths, **kwargs)`. Copy 0/1/2-reference branching (text→ff→first-last frame model select, 50–58) + 429 exp-backoff (72–85). Config-factory: Veo primary, fal-LTX fallback by config not code. |

## 2.2 — LTX-Video → prompt + parameter craft (not code)
- **Source:** `github.com/Lightricks/LTX-Video` · **License: Apache-2.0** ✅ · repo is now a redirect shell (code moved to `Lightricks/LTX-2`); only README + configs survive.

| Piece | Source | INTERCEPT file | Adaptation |
|---|---|---|---|
| **6. Prompt-engineering spec** | `README.md` "Prompt Engineering" (288–299) | **add** `convex/render/promptBuilder.ts` | Single flowing chronological paragraph, action-first, ≤200 words; flattens a ViMax `ShotDescription` into the final Veo/fal string. |
| **7. Parameter guidance** | `README.md` "Parameter Guide" (305–312) + `configs/ltxv-13b-0.9.8-distilled.yaml` | render defaults in `convex/render/backend.ts` | guidance 3–3.5, steps 20–30 fast / 40+ quality, dims ÷32, frames ÷8+1 (257), ≤720×1280. fal IDs: `fal-ai/ltx-video-13b-dev`, `fal-ai/ltx-video-13b-distilled`. |

---

# TIER 3 — ONBOARDING (Zero-to-One beat)

## 3.1 — OnboardJS → headless onboarding state machine
- **Source:** `github.com/Somafet/onboardjs` · **License: MIT** ✅ · can also `npm i @onboardjs/core` directly (headless, zero UI lock-in).
- **Attribution:** MIT header retained; PostHog plugin code is MIT-copyable directly.

| Piece | Source | INTERCEPT file | Adaptation |
|---|---|---|---|
| **A. Headless engine** | `packages/core/src/engine/OnboardingEngine.ts`; step union `types/step.ts` | adopt dep or port into onboarding layer | Mirror API (`next/previous/skip/goToStep/updateContext/updateChecklistItem`) + event bus. `_operationQueue` serializes async transitions — relevant to multi-tool chat turns. Use `CHECKLIST` (progress beats) + `CUSTOM_COMPONENT` (inline live-canvas card) step types. |
| **B. Persistence seam** ⭐ | `engine/PersistenceManager.ts`; `DataLoadFn`/`DataPersistFn` in `engine/types.ts` | **add** `convex/onboarding.ts` (`onboardingState` table keyed by userId) | Implement the injected `loadData`/`persistData` pair against Convex: `loadData` → query `api.onboarding.getProgress`; `persistData` → mutation `api.onboarding.saveProgress`. Reactive multi-device onboarding for free — strictly better than their Supabase plugin. |
| **C. React bindings** | `packages/react/src/context/OnboardingProvider.tsx`, `hooks/useOnboarding.tsx` | mount in `app/(app)/layout.tsx` or `OnboardingShell` | `<OnboardingProvider steps loadData persistData>`; chat/live-canvas consume `useOnboarding()`. `CUSTOM_COMPONENT` steps render inline in the chat stream. |
| **D. Next navigator** (optional) | `packages/react/src/adapters/next.ts::createNextNavigator` | only if URL-addressable steps (`/onboarding/[step]`) | Minimal `next/navigation` wrapper; skip if onboarding lives entirely in chat. |
| **E. Plugin/analytics** (optional) | `plugins/types.ts`; `plugins/posthog/src/PostHogPlugin.ts` + `utils/churnDetection.ts` | telemetry plugin → Convex/PostHog | Port `install(engine) => cleanup` shape + churn-timeout idea (5 min idle = at-risk), milestone events at [25,50,75,100]%. |

## 3.2 — Product tour (replaces AGPL Shepherd)
- **DO NOT use Shepherd source (AGPL).** Reimplement its UX yourself: **add** `components/onboarding/ProductTour.tsx` + tour-step defs consumed by the same `OnboardingProvider`. Model each tour stop as an OnboardJS step carrying `{ anchorSelector, placement, advanceOnEvent }`. Render tooltip with shadcn/Radix `Popover` + floating-ui (MIT). Use `advanceOn` semantics so the tour advances when the user actually clicks "Run discovery" / "Send first sequence" — not a dumb Next button. One state machine, zero AGPL exposure.

## 3.3 — Orchestration frameworks → KEEP CONVEX (reference reads only)
- **Mastra** (Apache-2.0) and **OpenClaw** (MIT): do **not** adopt. Convex already gives native durable functions, scheduler/cron, and reactive live-query — Mastra's suspend/resume + storage would be a *second* state engine and break our live-canvas reactivity. Read them for design vocabulary (`.branch()/.parallel()` north stars; "live Canvas you control" validation) only.

---

# ✅ CLEAN BUILD CHECKLIST (ordered by leverage)

**Phase 0 — Free real data (kills paid vendor dependency)**
- [ ] `lib/contract.ts`: mirror the Tomba enriched-contact field schema (mirror only; do not import the API).
- [ ] `lib/emailFinder.ts`: port email-sleuth Pieces **A** (patterns) + **D** (scoring + generic-prefix list). Pure, runs in Convex.
- [ ] `lib/smtpVerify.ts`: port Piece **B** (DNS MX, `"use node"` Convex action).
- [ ] Deploy external **port-25 SMTP worker** (Fly.io/Railway/VPS) exposing `POST /verify`; port Piece **C** into it; call from `lib/smtpVerify.ts` via `lib/safeFetch.ts`. *(Only hard infra dependency in the whole plan.)*
- [ ] `lib/scrape.ts`: port crawl4ai Pieces **E** (`scrapeToJSON` via `chatJSON`) + **F** (`learnSiteSchema`/`extractWithSchema` via `cheerio`).
- [ ] Add **`NOTICE`** file with the crawl4ai attribution line.
- [ ] Repoint `convex/agents/enrich.ts` + `convex/agents/detective.ts` from `lib/orangeslice.ts`/`lib/fiber.ts` → `lib/emailFinder.ts` + `lib/smtpVerify.ts` + `lib/scrape.ts`. **Retire the paid email + scrape layers.**

**Phase 1 — Outbound depth (the differentiator)**
- [ ] `convex/agents/enrich.ts`: add Piece **1A** profiler (+ `profiles` field in `convex/schema.ts`).
- [ ] `convex/agents/twin.ts`: add Piece **1B** digital twin; reuse prompt in `convex/agents/reply.ts`.
- [ ] `convex/outreach.ts` (+ constants module): add Piece **1C** LHS strategy gen (8–20 variants).
- [ ] `convex/outreach.ts` + `convex/run.ts`: add Piece **1D** simulate→rank→playbook; persist objection map on lead.
- [ ] `lib/openai.ts` + `lib/gemini.ts`: add `randomModel` rotation (twin/judge ≠ writer).
- [ ] `convex/schema.ts`: add SDR status enum + `icpScore`/`leadTier` (Pieces **2A**, **2C**).
- [ ] `convex/agents/router.ts`: 10-stage state machine (**2A**).
- [ ] `convex/crons.ts`: heartbeat dispatcher + Day 1/3/7/14 + stalled/quote/channel-switch (**2B**, **2E**).
- [ ] `lib/openai.ts`: add `COMPRESSION_PROMPT` compactor (**2D**).

**Phase 2 — AI ad factory**
- [ ] `convex/schema.ts`: `videoProjects`/`scenes`/`shots`/`characters` tables (ViMax Piece 4).
- [ ] `convex/prompts/screenwriter.ts`: verbatim screenwriter prompts (Piece 2).
- [ ] `convex/agents/storyboard.ts`: ff/lf decomposition + variation taxonomy (Piece 3 ⭐).
- [ ] `convex/render/backend.ts`: `VideoGenerator`-conforming Veo-primary/fal-LTX-fallback factory (Pieces 5 + 7).
- [ ] `convex/render/promptBuilder.ts`: LTX prompt-flattener (Piece 6).
- [ ] Model orchestration as a Convex durable workflow with skip-if-present idempotency (Piece 1).

**Phase 3 — Onboarding**
- [ ] `convex/onboarding.ts`: `onboardingState` table + `getProgress`/`saveProgress` (OnboardJS Piece B seam).
- [ ] Adopt `@onboardjs/core`; mount `OnboardingProvider` + `useOnboarding()` in `app/(app)/layout.tsx` (Pieces A, C).
- [ ] `components/onboarding/ProductTour.tsx`: reimplement tour UX on shadcn + floating-ui driven by OnboardJS. **DO NOT use Shepherd source (AGPL).**
- [ ] (optional) telemetry plugin (Piece E); Next navigator (Piece D).
- [ ] Keep Convex for orchestration — Mastra/OpenClaw are reference reads only.

**License gate (before any commit):** retain MIT headers on verbatim ports (email-sleuth, ai-sales-agent-simulator `src/*`, ViMax prompts/contracts, OnboardJS); ship the crawl4ai `NOTICE`; confirm **no Shepherd source** entered the tree.
