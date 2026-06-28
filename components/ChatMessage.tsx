"use client";

import { ROUTER_INTENTS } from "@/lib/contract";
import { cn } from "@/lib/utils";
import { relativeTime, initials } from "./format";
import type { ChatMessageDoc } from "./types";

// ============================================================================
// ChatMessage — one turn in the conversation.
//  • user      → right-aligned accent bubble
//  • assistant → left, plain; the live token stream IS `content` growing
//                reactively while `isStreaming` (the router patches it every
//                ~110ms off Convex's reactive `getMessages`), then the persisted
//                final text. A capability chip links it to the canvas.
//  • proactive → a "24/7" badge ("while you were away …")
// ============================================================================

interface ChatMessageProps {
  message: ChatMessageDoc;
  /** Focus the canvas on the run this message spawned. */
  onFocusRun?: (runId: ChatMessageDoc["runId"], intent?: string) => void;
  /** True when this is the run the canvas is currently showing. */
  focused?: boolean;
}

function intentTitle(intent?: string): string | undefined {
  if (!intent) return undefined;
  return ROUTER_INTENTS.find((r) => r.intent === intent)?.title ?? intent;
}

/** Render light markdown: **bold**, line breaks, and bullet lines. No deps. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => /^\s*[-*•]\s+/.test(l)) && lines.length > 0;
        if (isList) {
          return (
            <ul key={bi} className="my-1.5 ml-4 list-disc space-y-1 marker:text-ink/40">
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-*•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi} className={bi > 0 ? "mt-2.5" : ""}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {inline(l)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function inline(s: string): React.ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-fig-card">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export default function ChatMessage({ message, onFocusRun, focused }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const streaming = message.role === "assistant" && message.isStreaming === true;

  // The live token feed IS `message.content`: the router grows it reactively
  // while `isStreaming`, so we render it directly (no extra stream channel).
  const text = message.content;
  const showCaret = streaming;
  const empty = streaming && text.length === 0;

  const title = intentTitle(message.intent);

  if (isSystem) {
    return (
      <div className="my-1 flex justify-center">
        <span className="caption rounded-full border border-hairline bg-surface-soft px-3 py-1 text-ink">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex w-full gap-3 px-1", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* avatar */}
      <div className="mt-0.5 shrink-0">
        {isUser ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-soft text-[11px] font-fig-headline text-ink">
            {initials(undefined, "You")}
          </span>
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-ink text-canvas">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
              <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="m20 20-4.6-4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
        )}
      </div>

      <div className={cn("flex min-w-0 max-w-[88%] flex-col gap-1.5", isUser ? "items-end" : "items-start")}>
        {/* proactive 24/7 badge */}
        {message.proactive && !isUser && (
          <span className="caption inline-flex items-center gap-1.5 rounded-full bg-block-mint px-2 py-1 text-ink">
            <span className="live-dot text-success" />
            24/7 · while you were away
          </span>
        )}

        <div
          className={cn(
            "rounded-lg px-3.5 py-2.5 text-[14px] leading-relaxed",
            isUser
              ? "bg-ink text-canvas rounded-tr-sm"
              : "border border-hairline bg-surface-soft text-ink rounded-tl-sm",
          )}
        >
          {empty ? (
            <span className="inline-flex items-center gap-1 py-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40" />
            </span>
          ) : (
            <div className="whitespace-pre-wrap break-words">
              <RichText text={text} />
              {showCaret && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-blink bg-current align-middle" />}
            </div>
          )}
        </div>

        {/* capability chip → focuses the canvas on the spawned run */}
        {!isUser && message.runId && title && (
          <button
            type="button"
            onClick={() => onFocusRun?.(message.runId, message.intent)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[12px] font-fig-link transition-colors",
              focused
                ? "border-transparent bg-primary text-on-primary"
                : "border-hairline bg-canvas text-ink hover:bg-surface-soft",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", focused ? "bg-on-primary" : "bg-ink")} />
            {title}
            <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3">
              <path d="M5 12h14m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}

        <span className="caption px-1 text-ink/60">{relativeTime(message.createdAt)}</span>
      </div>
    </div>
  );
}
