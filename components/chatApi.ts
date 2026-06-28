"use client";

// ============================================================================
// chatApi — the typed contract bridge between the UI (Builder A) and the chat /
// outbound backend modules (Builders B + C) that are built in parallel.
//
// Those modules (convex/chat.ts, conversations, prospects, emails, events,
// campaigns) are NOT in the generated `api` yet, so referencing `api.chat.*`
// would not type-check. Instead we declare *typed* `makeFunctionReference`s here:
// the UI compiles independently and these bind at runtime once the modules
// deploy. Every signature below is the contract Builders B/C must satisfy.
//
// Modules that ALREADY exist (runs, brief, ads, drafts, outreach, agents.*) are
// consumed via the generated `api` directly in their components — not here.
// ============================================================================

import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  CampaignStatus,
  EmailStatus,
} from "@/lib/contract";
import type {
  CampaignDoc,
  ChatMessageDoc,
  ConversationDoc,
  EmailDoc,
  EventDoc,
  ProspectDoc,
} from "./types";

// ---------------------------------------------------------------------------
// CHAT (convex/chat.ts — Builder B)
// ---------------------------------------------------------------------------

/** All conversations, most-recently-active first. */
export const listConversationsRef = makeFunctionReference<
  "query",
  Record<string, never>,
  ConversationDoc[]
>("conversations:getConversations");

/** Create an empty conversation; returns its id. */
export const createConversationRef = makeFunctionReference<
  "mutation",
  { title?: string },
  Id<"conversations">
>("conversations:createConversation");

/** Delete a conversation and its messages. */
export const deleteConversationRef = makeFunctionReference<
  "mutation",
  { conversationId: Id<"conversations"> },
  null
>("conversations:deleteConversation");

/** The message stream for a conversation, oldest-first. */
export const getMessagesRef = makeFunctionReference<
  "query",
  { conversationId: Id<"conversations"> },
  ChatMessageDoc[]
>("conversations:getMessages");

/**
 * Send a user message. Inserts the user row + an empty streaming assistant
 * placeholder, schedules the router (convex/chat.ts `generate`), and (creating a
 * conversation if `conversationId` is omitted) returns the ids the client needs.
 * Streaming is Convex-native: the assistant message's `content` grows reactively
 * off `getMessages`, so there is no separate `streamId` to drive.
 */
export const sendMessageRef = makeFunctionReference<
  "mutation",
  { conversationId?: Id<"conversations">; text: string },
  {
    conversationId: Id<"conversations">;
    userMessageId: Id<"messages">;
    assistantMessageId: Id<"messages">;
  }
>("conversations:send");

// ---------------------------------------------------------------------------
// OUTBOUND canvas reads/writes (convex/prospects.ts · emails.ts · events.ts ·
// campaigns.ts — Builder C). All keyed by the swarm `runId` the canvas renders.
// ---------------------------------------------------------------------------

export const prospectsByRunRef = makeFunctionReference<
  "query",
  { runId: Id<"runs"> },
  ProspectDoc[]
>("prospects:byRun");

export const emailsByRunRef = makeFunctionReference<
  "query",
  { runId: Id<"runs"> },
  EmailDoc[]
>("emails:byRun");

/** Move a draft email through the approval gate (approve / skip). */
export const setEmailStatusRef = makeFunctionReference<
  "mutation",
  { emailId: Id<"emails">; status: EmailStatus },
  { ok: boolean }
>("emails:gate");

/** Send an APPROVED email via AgentMail (server re-checks the gate). */
export const sendEmailRef = makeFunctionReference<
  "action",
  { emailId: Id<"emails"> },
  { sent: boolean; reason?: string; id?: string }
>("outreach:sendApprovedEmail");

export const eventsByRunRef = makeFunctionReference<
  "query",
  { runId: Id<"runs"> },
  EventDoc[]
>("events:feedForRun");

/** The campaign behind an outbound run — powers the 24/7 watch toggle. */
export const campaignForRunRef = makeFunctionReference<
  "query",
  { runId: Id<"runs"> },
  CampaignDoc | null
>("campaigns:getForRun");

/** Flip a campaign's status — `active` === the 24/7 watch is on. */
export const setCampaignStatusRef = makeFunctionReference<
  "mutation",
  { campaignId: Id<"campaigns">; status: CampaignStatus },
  null
>("campaigns:setStatus");

// ---------------------------------------------------------------------------
// Streaming endpoint URL. Convex HTTP actions live on the `.convex.site` origin
// (the deployment's sibling of `.convex.cloud`). Prefer an explicit override.
// ---------------------------------------------------------------------------
export function convexSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/$/, "");
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  return cloud.replace(/\.convex\.cloud\/?$/, ".convex.site");
}

/** The /chat-stream URL `useStream` POSTs to (driving) and reads from. */
export function chatStreamUrl(): URL {
  const base = convexSiteUrl();
  try {
    return new URL("/chat-stream", base || "https://placeholder.convex.site");
  } catch {
    return new URL("https://placeholder.convex.site/chat-stream");
  }
}
