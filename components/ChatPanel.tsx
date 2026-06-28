"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import ChatMessage from "./ChatMessage";
import { getMessagesRef, sendMessageRef } from "./chatApi";
import type { ChatMessageDoc } from "./types";

// ============================================================================
// ChatPanel — the conversation (left). Owns the message stream + composer.
// Paste/type ANYTHING; the router decides and the canvas lights up beside it.
// ============================================================================

const EXAMPLES: { label: string; text: string }[] = [
  { label: "Find live buyer threads", text: "find where buyers are talking about resend.com" },
  { label: "Build an outbound list", text: "find customers for resend.com — fintech Heads of Growth" },
  { label: "Competitor ad teardown", text: "what ads is brex running right now" },
  { label: "Make a video ad", text: "make me a launch video ad for an open-source Postgres host" },
];

interface ChatPanelProps {
  conversationId: Id<"conversations"> | null;
  setConversationId: (id: Id<"conversations">) => void;
  focusedRunId?: Id<"runs"> | null;
  onFocusRun?: (runId: Id<"runs"> | undefined, intent?: string) => void;
}

export default function ChatPanel({
  conversationId,
  setConversationId,
  focusedRunId,
  onFocusRun,
}: ChatPanelProps) {
  const messages = useQuery(
    getMessagesRef,
    conversationId ? { conversationId } : "skip",
  ) as ChatMessageDoc[] | undefined;
  const send = useMutation(sendMessageRef);

  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasMessages = (messages?.length ?? 0) > 0;
  const streamingActive = (messages ?? []).some(
    (m) => m.role === "assistant" && m.isStreaming,
  );

  // Auto-grow the textarea.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  // Stick to the bottom as turns arrive.
  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [messages?.length, scrollToBottom]);

  // Follow live tokens while a turn streams.
  useEffect(() => {
    if (!streamingActive) return;
    const t = setInterval(() => scrollToBottom(false), 160);
    return () => clearInterval(t);
  }, [streamingActive, scrollToBottom]);

  const submit = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || sending) return;
      setSending(true);
      setError(null);
      setValue("");
      try {
        const res = await send({
          conversationId: conversationId ?? undefined,
          text,
        });
        if (res?.conversationId && res.conversationId !== conversationId) {
          setConversationId(res.conversationId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't send. Try again.");
        setValue(text);
      } finally {
        setSending(false);
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    },
    [send, conversationId, sending, setConversationId],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit(value);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas text-ink">
      {/* messages */}
      <div ref={scrollRef} className="col-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6">
          {!hasMessages ? (
            <Welcome onPick={(t) => void submit(t)} />
          ) : (
            (messages ?? []).map((m) => (
              <ChatMessage
                key={m._id}
                message={m}
                focused={!!m.runId && m.runId === focusedRunId}
                onFocusRun={onFocusRun}
              />
            ))
          )}
        </div>
      </div>

      {/* composer */}
      <div className="border-t border-hairline bg-canvas px-4 py-3">
        <form onSubmit={onSubmit} className="mx-auto w-full max-w-2xl">
          <div className="text-input flex items-end gap-2 !p-2">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Paste a company, a competitor, an idea — or just ask…"
              className="max-h-[200px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[14px] leading-relaxed text-ink placeholder:text-ink/35 focus:outline-none"
              aria-label="Message INTERCEPT"
            />
            <button
              type="submit"
              disabled={!value.trim() || sending}
              className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
            >
              {sending ? (
                <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-on-primary/30 border-t-on-primary" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                  <path d="M5 12h14m0 0-5-5m5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
          {error && <p className="mt-2 px-1 text-body-sm text-red-500">{error}</p>}
          <p className="caption mt-2 px-1 text-ink/60">
            INTERCEPT routes every message — discovery · outbound · outreach · content · competitor intel.
          </p>
        </form>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center animate-fade-up">
      <span className="flex h-12 w-12 items-center justify-center rounded-md bg-ink text-canvas">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
          <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="m20 20-4.6-4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <h1 className="mt-5 text-balance text-headline text-ink">
        What should we go after?
      </h1>
      <p className="mt-2 max-w-md text-body-sm text-ink">
        Paste a company, a competitor, or an idea. I&apos;ll decide what to do —
        find live buyer threads, source decision-makers, draft outreach, scout
        competitor ads, or make the creative — and work it live beside us.
      </p>
      <div className="mt-7 grid w-full max-w-md gap-2 sm:grid-cols-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.text}
            type="button"
            onClick={() => onPick(ex.text)}
            className="group rounded-md border border-hairline bg-surface-soft p-3 text-left transition-colors hover:bg-canvas"
          >
            <span className="block text-body-sm font-fig-headline text-ink">
              {ex.label}
            </span>
            <span className="mt-0.5 block truncate text-[12px] font-fig-body text-ink">
              {ex.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
