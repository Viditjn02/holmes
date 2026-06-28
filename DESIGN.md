# INTERCEPT — Interface Design (AI mission-control for GTM)

One AI-native chat that runs the entire GTM stack (all 6 tracks). Not a form, not 7 panels — **one chat + a canvas that morphs to whatever you asked for.** Premium, dark, alive.

## 1. Concept
"Mission control for go-to-market." You talk to it; it dispatches a swarm; the canvas shows the work happening live. The awe is watching agents light up and real results stream in.

## 2. Aesthetic — Linear-dark base + a live "signal" accent
Grounded in Linear's design system (dark-native, precise) with INTERCEPT's own signal-amber accent (ties to Orange Slice + the "intercept/radar" idea).

| Token | Value |
|---|---|
| Canvas (deepest) | `#08090a` |
| Panel | `#0f1011` |
| Elevated surface | `#191a1b` |
| Hover surface | `#28282c` |
| Primary text | `#f7f8f8` (never pure white) |
| Body text | `#d0d6e0` · muted `#8a8f98` · subtle `#62666d` |
| Border default | `rgba(255,255,255,0.08)` · subtle `rgba(255,255,255,0.05)` |
| **Accent (signal)** | `#ff6a2b` (amber) → hover `#ff8a52` — CTAs, active agents, live signals ONLY |
| Live / positive | `#34d399` (green) — "active", replies, booked |
| Type | **Inter Variable**, `font-feature-settings: "cv01","ss03"`, weight **510** for UI, 590 for emphasis, 400 body. Display tight tracking (-1px+). Mono: Berkeley/SF Mono for signals + scores. |
| Radius | 6px buttons/inputs · 8px cards · 12px panels · pill chips · 50% dots |
| Depth | luminance stepping (bg opacity 0.02→0.05), semi-transparent white borders, no blur drop-shadows |

## 3. Layout
```
┌──────────────────────────────────────────────────────────────────────────┐
│  ◐ INTERCEPT          ⌘K  search/command            ● live · 6 agents      │  top bar
├────────────┬─────────────────────────────────────────────────────────────┤
│  RAIL      │  CHAT                          │  CANVAS (morphs per task)     │
│  ───────   │  ───────────────────────────   │  ───────────────────────────  │
│  ◇ Home    │  you ▸ "find customers for     │  ┌─ SWARM ──────────────────┐ │
│  ◇ Runs    │        resend.com"             │  │ sourcer ● enricher ● ...  │ │  live agents
│  ◇ Inbox   │                                │  └───────────────────────────┘ │
│  ◇ Content │  ◐ routing → Outbound + Signal │  ╔═ the right view for the ══╗ │
│  ───────   │  ◐ sourced 42 · enriched 30…   │  ║  task: pipeline kanban /  ║ │
│  recent    │  ◐ drafted 12 emails, grounded │  ║  intent-thread list /     ║ │
│  · resend  │     in real signals ▸          │  ║  creative gallery /       ║ │
│  · cursor  │  [approve all] [review each]    │  ║  content calendar /       ║ │
│            │  ┌─ type anything ───────── ▸ ┐ │  ║  onboarding flow builder  ║ │
│            │  └─────────────────────────────┘ │  ╚═══════════════════════════╝ │
└────────────┴─────────────────────────────────────────────────────────────┘
```
- **Chat (center)** is the only input — paste a URL / company / competitor / idea / "find customers for X". Streaming, agentic: it shows routing → which agents → progress → result, conversationally.
- **Canvas (right)** is the star: it renders the right view for whatever the chat is doing. Same shell, different content. Never empty — it shows the swarm working, then the result.
- **Rail (left)** is thin: Home / Runs / Inbox / Content + recent runs. You don't navigate to do things — the chat routes. The rail is memory.

## 4. The morphing canvas (how all 6 tracks live in ONE shell)
| Ask | Canvas renders |
|---|---|
| Reading Minds (discovery) | **intent-thread list** — clickable, intent-scored (mono score badge, color by `ready_to_buy`), community → thread → author |
| Revenue on Autopilot (outbound) | **pipeline kanban** — sourced → enriched → qualified → contacted → replied → booked; prospect cards; email preview + approve |
| AI Ad Factories | **creative gallery** — the Veo video player, landing-page preview (iframe), copy variants |
| Sales Cyborgs | **email/thread composer** + the digital-twin pitch score |
| Algorithm Hacking | **content calendar** — multi-variant posts queued per platform |
| Zero to One | **flow builder** — the generated onboarding tour preview |
One header strip across all of them: the **live swarm** (the 6 agents pulsing through queued→running→done, amber when active, green when done).

## 5. AI-native interactions
- **⌘K command palette** (Linear-style) — jump anywhere, re-run, paste.
- **Streaming agent reasoning** inline in chat (you see it think + act, not a spinner).
- **Approve gate inline** — "approve all / review each" right in the conversation.
- **Everything is one input.** No forms. You say it, it does it.

## 6. The signature awe beat
When a run starts: the swarm strip ignites — 6 agent nodes, edges drawing between them, each pulsing amber as it works, flipping green as results land, and the canvas filling with real data in real time. That 5-second "it's alive" moment is the demo climax.

## 7. To generate the visual in Open Design (running app)
Pick design system: **`linear-app`** (closest to this spec). Paste this prompt:

> "Design a dark, premium AI-native web app called INTERCEPT — 'mission control for go-to-market.' Three-pane layout on near-black (#08090a): a thin left rail (Home/Runs/Inbox/Content + recent runs), a center CHAT (the only input — you type/paste anything and an AI agent streams its reasoning and runs a swarm), and a right CANVAS that morphs to show the work: a live 'swarm' header strip of 6 agent nodes pulsing amber→green, below it either an intent-scored thread list, a sales pipeline kanban (sourced→…→booked) with prospect cards + email preview, a creative gallery with a video player, or a content calendar. Inter Variable, weight 510, semi-transparent white borders, single amber accent #ff6a2b for active/CTA and green #34d399 for live/done, mono score badges. Make it feel like Linear x a radar/mission-control. Show the moment a run ignites and the canvas fills with real data."

Then export the screens and I wire them into `app/` + `components/`.
