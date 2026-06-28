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

// ---------------------------------------------------------------------------
// EMAIL DESIGN (convex/emailDesign.ts — Email-design builder). The EmailDesigner
// modal (mounted once globally; self-opens on `intercept:open-email-designer`)
// drives these. Saved branded templates live in a table (`emailTemplates`) the
// email-design builder is adding in parallel, so it is NOT in the generated
// dataModel yet — hence the doc `_id` is typed `string` here (same approach as
// KnowledgePageDoc in ./types). These bind at runtime once the module deploys.
// ---------------------------------------------------------------------------

/** Optional brand styling carried on a saved template (mirrors lib/brew BrandInfo). */
export interface EmailTemplateBrand {
  company?: string;
  logoUrl?: string;
  accentHex?: string;
  fromName?: string;
  websiteUrl?: string;
  footerNote?: string;
}

/** A saved, reusable branded email template. */
export interface EmailTemplateDoc {
  _id: string;
  _creationTime?: number;
  name: string;
  subject?: string;
  html: string;
  body?: string;
  brand?: EmailTemplateBrand;
  createdAt?: number;
  updatedAt?: number;
}

/** All saved branded templates, newest first. */
export const listEmailTemplatesRef = makeFunctionReference<
  "query",
  Record<string, never>,
  EmailTemplateDoc[]
>("emailDesign:listTemplates");

/** Persist a branded template for reuse; returns its id (string — table not yet codegen'd). */
export const saveEmailTemplateRef = makeFunctionReference<
  "mutation",
  {
    name: string;
    subject?: string;
    html: string;
    body?: string;
    brand?: EmailTemplateBrand;
  },
  string
>("emailDesign:saveTemplate");

/**
 * Send a Brew-designed (branded HTML) email. The server re-renders with the real
 * BREW_API_KEY and ships it via AgentMail, falling back to the supplied `html`
 * (or a plain send) if Brew is unconfigured. Never throws on the server side.
 */
export const sendDesignedEmailRef = makeFunctionReference<
  "action",
  {
    to?: string;
    subject: string;
    body: string;
    html?: string;
    templateId?: string;
    emailId?: Id<"emails">;
    runId?: Id<"runs">;
  },
  { sent: boolean; reason?: string; id?: string }
>("emailDesign:sendDesigned");

/** Send a plain-text cold email (no design) via AgentMail. */
export const sendPlainEmailRef = makeFunctionReference<
  "action",
  {
    to?: string;
    subject: string;
    body: string;
    emailId?: Id<"emails">;
    runId?: Id<"runs">;
  },
  { sent: boolean; reason?: string; id?: string }
>("emailDesign:sendPlain");
