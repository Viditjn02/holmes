# INTERCEPT — AI-native GTM platform (LOCKED SPEC + TODO)

> The one product. Build deep + real, on the existing Convex infra. Don't skip anything below.

## THE PRODUCT
**One AI-native CHAT, not a form.** You paste/type ANYTHING; an agent decides what to do and does it, replying conversationally with a live work canvas beside the chat. It is one platform that does customer discovery + 24/7 outreach + content + competitor intel — using REAL Orange Slice + Fiber data.

```
  ┌──────────────────────────────┐     ┌─────────────────────────────────┐
  │  CHAT (left)                 │     │  CANVAS (right) — live work      │
  │  "find customers for         │ ──▶ │  swarm lighting up · prospects · │
  │   resend.com" / paste a URL  │     │  threads · emails · pipeline ·   │
  │   / a competitor / an idea   │     │  competitor ads · the video      │
  └──────────────────────────────┘     └─────────────────────────────────┘
        ROUTER (one brain): classify intent → run the right capability
```

## CAPABILITIES (all in one, behind the chat)
1. **Community discovery (the moat)** — real, clickable, intent-scored live threads (Exa; free HN/Reddit fallback when Exa has no credits). Map community→thread→author, intent = browsing|comparing|frustrated|ready-to-buy.
2. **Outbound discovery** — find matching companies + decision-makers via **Orange Slice REAL data** + **Fiber REAL verified emails**.
3. **24/7 outreach (autonomous)** — signal-grounded personalized email → human-approve → send via **AgentMail** → follow-up; in-thread reply for community. Cron background loop ("found/sent these overnight").
4. **Competitor intel** — Meta Ad Library winning ads (rank by run-duration).
5. **Content** — Veo / fal-LTX video ad, landing page, ad copy.
6. **Compounding brain** — gbrain, smarter each run.

## REAL PLATFORM INTEGRATION (no stubs — Vidit was furious about this)
- **Orange Slice:** research + use the REAL API (`npx orangeslice@latest` / generateObject(), 50+ providers, firmographics, verified emails, de-anon, Reddit/LinkedIn/X listening, CRM, data/excel export). Use it for enrichment + outbound discovery + listening. NOT a no-op stub.
- **Fiber AI:** REAL verified-contact data (850M people + verification) for emails.
- **AgentMail:** real send + queryable inbox (reply lands on the board).
- **Exa:** real thread discovery (+ free HN Algolia / Reddit JSON fallback for $0).
- **Veo / fal-ai LTX-2.3:** video. **PostHog:** live analytics. **gbrain:** compounding (CLI).

## BUILD ON WHAT EXISTS
Reuse: Convex spine, the swarm orchestrator + agentStatus board, AgentMail (convex/outreach.ts, lib/agentmail.ts), the 24/7 monitor cron, OpenAI (lib/openai.ts), the green local deploy. Adapt proven OSS as deps; never vendor whole-project source.

## QUALITY GATES (don't claim done until ALL true)
- [ ] Chat-native UX works: paste anything → router decides → it runs → conversational reply + live canvas.
- [ ] Orange Slice + Fiber are REALLY integrated (real API calls, real data shape), not stubs.
- [ ] Community discovery returns real clickable intent-scored threads (or the free fallback does).
- [ ] Outbound finds real prospects + drafts signal-grounded emails + can send via AgentMail (test inbox).
- [ ] 24/7 loop runs on the cron.
- [ ] Content (video/landing) generates.
- [ ] `npx convex dev --once` GREEN + `tsc` clean + a real smoke run produces real output.
- [ ] UI is genuinely polished + cohesive (chat + canvas), enterprise-grade — not empty panels.

## TODO ORDER
1. Research Orange Slice + Fiber real APIs/capabilities (web + their docs).
2. Schema + the chat/router contract.
3. Chat UI + canvas (the centerpiece).
4. Router brain (classify input → run capability) on the existing orchestrator.
5. Capabilities wired to REAL data (discovery, outbound, outreach, content, competitor, brain).
6. 24/7 cron loop.
7. Verify green + real smoke run. Polish. Push.
