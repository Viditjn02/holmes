"use client";

import { useCallback, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { relativeTime } from "./format";
import { EMAIL_STATUS_META, tintStyle } from "./pipelineMeta";
import {
  emailsByRunRef,
  sendEmailRef,
  setEmailStatusRef,
} from "./chatApi";
import type { EmailDoc } from "./types";

// ============================================================================
// EmailQueue — the 24/7 outreach approval gate. Signal-grounded drafts from the
// writer agent; nothing leaves without a human Approve, and only the sender
// (AgentMail) flips approved → sent. Reads emails:listByRun reactively.
// ============================================================================

function EmailRow({ email }: { email: EmailDoc }) {
  const setStatus = useMutation(setEmailStatusRef);
  const sendEmail = useAction(sendEmailRef);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "approve" | "skip" | "send">(null);
  const [note, setNote] = useState<string | null>(null);

  const meta = EMAIL_STATUS_META[email.status];
  const isDraft = email.status === "draft";
  const isApproved = email.status === "approved";
  const isSent = email.status === "sent" || email.status === "replied";

  const approve = useCallback(async () => {
    setBusy("approve");
    setNote(null);
    try {
      await setStatus({ emailId: email._id, status: "approved" });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't approve.");
    } finally {
      setBusy(null);
    }
  }, [setStatus, email._id]);

  const skip = useCallback(async () => {
    setBusy("skip");
    setNote(null);
    try {
      await setStatus({ emailId: email._id, status: "skipped" });
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't skip.");
    } finally {
      setBusy(null);
    }
  }, [setStatus, email._id]);

  const send = useCallback(async () => {
    setBusy("send");
    setNote(null);
    try {
      const res = await sendEmail({ emailId: email._id });
      if (!res?.sent) setNote(res?.reason ?? "AgentMail not configured.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(null);
    }
  }, [sendEmail, email._id]);

  return (
    <div className="rounded-xl border border-line bg-panel/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
              style={tintStyle(meta.hex)}
            >
              {meta.label}
            </span>
            {email.kind === "followup" && (
              <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-white/45">
                follow-up {email.step}
              </span>
            )}
          </div>
          <p className="mt-1.5 truncate text-[13px] font-semibold text-zinc-100">{email.subject}</p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500">
            {email.to ? `to ${email.to}` : "recipient resolved at send"}
            {email.signalRef ? ` · ${email.signalRef}` : ""}
          </p>
        </button>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={cn("mt-1 h-4 w-4 shrink-0 text-white/30 transition-transform", open && "rotate-180")}
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && (
        <div className="mt-2.5 rounded-lg border border-line bg-ink/50 p-3">
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-300">{email.body}</p>
        </div>
      )}

      {email.status === "replied" && email.replyBody && (
        <div className="mt-2 rounded-lg border border-good/30 bg-good/5 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-good">They replied {relativeTime(email.repliedAt)}</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] text-zinc-300">{email.replyBody}</p>
        </div>
      )}

      {/* actions */}
      {!isSent && (
        <div className="mt-2.5 flex items-center gap-2">
          {isDraft && (
            <>
              <button
                onClick={approve}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-good px-3 py-1.5 text-[12px] font-semibold text-ink transition-transform hover:scale-[1.02] disabled:opacity-50"
              >
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
              <button
                onClick={skip}
                disabled={!!busy}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-zinc-300 ring-1 ring-line transition-colors hover:bg-white/5 disabled:opacity-50"
              >
                {busy === "skip" ? "…" : "Skip"}
              </button>
            </>
          )}
          {isApproved && (
            <button
              onClick={send}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink transition-transform hover:scale-[1.02] disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <path d="m22 2-7 20-4-9-9-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M22 2 11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {busy === "send" ? "Sending…" : "Send via AgentMail"}
            </button>
          )}
          {note && <span className="text-[11px] text-zinc-500">{note}</span>}
        </div>
      )}
      {isSent && (
        <p className="mt-2 text-[11px] text-good">
          {email.status === "replied" ? "Replied" : "Sent"} via AgentMail {relativeTime(email.sentAt)}
        </p>
      )}
    </div>
  );
}

export default function EmailQueue({ runId }: { runId: Id<"runs"> }) {
  const emails = useQuery(emailsByRunRef, { runId }) as EmailDoc[] | undefined;

  const pending = (emails ?? []).filter((e) => e.status === "draft" || e.status === "approved");
  const done = (emails ?? []).filter((e) => e.status !== "draft" && e.status !== "approved" && e.status !== "skipped");

  if (emails === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border border-line bg-panel/50" />
        ))}
      </div>
    );
  }

  const awaiting = (emails ?? []).filter((e) => e.status === "draft").length;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-zinc-50">Outreach queue</h3>
          <p className="text-[12.5px] text-zinc-500">
            Signal-grounded emails · human approval gate · AgentMail send
          </p>
        </div>
        {awaiting > 0 && (
          <span className="rounded-full bg-accent/15 px-3 py-1 text-[11px] font-semibold text-accent ring-1 ring-accent/30">
            {awaiting} awaiting approval
          </span>
        )}
      </div>

      {(emails?.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel/40 p-10 text-center text-[13px] text-zinc-500">
          The writer drafts a signal-grounded email per qualified prospect — they queue here for your approval.
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((e) => (
            <EmailRow key={e._id} email={e} />
          ))}
          {done.length > 0 && (
            <>
              <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-white/30">Shipped</p>
              {done.map((e) => (
                <EmailRow key={e._id} email={e} />
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
