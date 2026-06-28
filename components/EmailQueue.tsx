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
    <div className="rounded-lg border border-hairline bg-canvas p-3">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span
              className="caption rounded-full border px-2 py-0.5"
              style={tintStyle(meta.hex)}
            >
              {meta.label}
            </span>
            {email.kind === "followup" && (
              <span className="caption rounded-full bg-surface-soft px-1.5 py-0.5 text-ink/50">
                follow-up {email.step}
              </span>
            )}
          </div>
          <p className="mt-1.5 truncate text-[13px] font-fig-headline text-ink">{email.subject}</p>
          <p className="mt-0.5 truncate text-[11px] text-ink/50">
            {email.to ? `to ${email.to}` : "recipient resolved at send"}
            {email.signalRef ? ` · ${email.signalRef}` : ""}
          </p>
        </button>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={cn("mt-1 h-4 w-4 shrink-0 text-ink/30 transition-transform", open && "rotate-180")}
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && (
        <div className="mt-2.5 rounded-md border border-hairline bg-surface-soft p-3">
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink/70">{email.body}</p>
        </div>
      )}

      {email.status === "replied" && email.replyBody && (
        <div className="mt-2 rounded-md border border-hairline bg-block-mint p-2.5">
          <p className="caption text-success">They replied {relativeTime(email.repliedAt)}</p>
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] text-ink/80">{email.replyBody}</p>
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
                className="inline-flex items-center gap-1.5 rounded-pill bg-block-mint px-4 py-1.5 text-[12px] font-fig-link text-ink transition-colors hover:bg-block-mint/80 disabled:opacity-50"
              >
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
              <button
                onClick={skip}
                disabled={!!busy}
                className="rounded-pill border border-hairline bg-canvas px-4 py-1.5 text-[12px] font-fig-link text-ink transition-colors hover:bg-surface-soft disabled:opacity-50"
              >
                {busy === "skip" ? "…" : "Skip"}
              </button>
            </>
          )}
          {isApproved && (
            <button
              onClick={send}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 rounded-pill bg-primary px-4 py-1.5 text-[12px] font-fig-link text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5">
                <path d="m22 2-7 20-4-9-9-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <path d="M22 2 11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {busy === "send" ? "Sending…" : "Send via AgentMail"}
            </button>
          )}
          {note && <span className="text-[11px] text-ink/50">{note}</span>}
        </div>
      )}
      {isSent && (
        <p className="mt-2 text-[11px] text-success">
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
          <div key={i} className="h-20 animate-pulse rounded-lg border border-hairline bg-surface-soft" />
        ))}
      </div>
    );
  }

  const awaiting = (emails ?? []).filter((e) => e.status === "draft").length;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-fig-headline text-ink">Outreach queue</h3>
          <p className="text-[12.5px] text-ink/60">
            Signal-grounded emails · human approval gate · AgentMail send
          </p>
        </div>
        {awaiting > 0 && (
          <span className="caption rounded-full bg-block-cream px-3 py-1 text-ink">
            {awaiting} awaiting approval
          </span>
        )}
      </div>

      {(emails?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-surface-soft p-10 text-center text-[13px] text-ink/60">
          The writer drafts a signal-grounded email per qualified prospect — they queue here for your approval.
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((e) => (
            <EmailRow key={e._id} email={e} />
          ))}
          {done.length > 0 && (
            <>
              <p className="caption px-1 pt-1 text-ink/40">Shipped</p>
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
