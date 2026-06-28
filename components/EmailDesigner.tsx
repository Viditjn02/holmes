"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { designEmail, type BrandInfo } from "@/lib/brew";
import {
  listEmailTemplatesRef,
  saveEmailTemplateRef,
  sendDesignedEmailRef,
  sendPlainEmailRef,
  type EmailTemplateDoc,
} from "./chatApi";

// ============================================================================
// EmailDesigner — global email design drawer.
// ----------------------------------------------------------------------------
// Mounted ONCE at the app root; it self-opens when the outreach queue dispatches
//   window.dispatchEvent(new CustomEvent("intercept:open-email-designer", {
//     detail: { to, subject, body, emailId?, runId?, brand? } }))
//
// From a draft (to/subject/body) the human can:
//   • DESIGN a branded HTML email (Brew) — pick/save a reusable TEMPLATE, or
//   • send a PLAIN cold email (no design).
// Actions: Save as template · Send designed · Send plain.
//
// Backend: convex/emailDesign.ts (built in parallel) — bound via typed
// makeFunctionReference in ./chatApi so this compiles standalone before codegen:
//   emailDesign:listTemplates · saveTemplate · sendDesigned · sendPlain
//
// Graceful by contract: Brew is unconfigured on the client, so the live preview
// is the clean default template; the real branded render happens server-side in
// sendDesigned. Every async path is guarded — the modal never throws.
// ============================================================================

interface OpenEmailDesignerDetail {
  to?: string;
  subject?: string;
  body?: string;
  emailId?: Id<"emails">;
  runId?: Id<"runs">;
  brand?: BrandInfo;
}

type Mode = "design" | "plain";
type Busy = null | "save" | "designed" | "plain";

interface DraftState {
  to: string;
  subject: string;
  body: string;
}

const EMPTY_DRAFT: DraftState = { to: "", subject: "", body: "" };

export default function EmailDesigner() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [emailId, setEmailId] = useState<Id<"emails"> | undefined>(undefined);
  const [runId, setRunId] = useState<Id<"runs"> | undefined>(undefined);
  const [brand, setBrand] = useState<BrandInfo | undefined>(undefined);

  const [mode, setMode] = useState<Mode>("design");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [designing, setDesigning] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  // Backend bindings (resolve at runtime once convex/emailDesign.ts deploys).
  const templates = useQuery(listEmailTemplatesRef, {}) as EmailTemplateDoc[] | undefined;
  const saveTemplate = useMutation(saveEmailTemplateRef);
  const sendDesigned = useAction(sendDesignedEmailRef);
  const sendPlain = useAction(sendPlainEmailRef);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
  }, [busy]);

  // ── Self-open on the outreach-queue event ──────────────────────────────────
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenEmailDesignerDetail>).detail ?? {};
      setDraft({
        to: detail.to ?? "",
        subject: detail.subject ?? "",
        body: detail.body ?? "",
      });
      setEmailId(detail.emailId);
      setRunId(detail.runId);
      setBrand(detail.brand);
      setMode("design");
      setSelectedTemplateId(null);
      setNote(null);
      setSent(false);
      setSavingTemplate(false);
      setTemplateName("");
      setPreviewHtml("");
      setOpen(true);
    };
    window.addEventListener("intercept:open-email-designer", onOpen as EventListener);
    return () =>
      window.removeEventListener("intercept:open-email-designer", onOpen as EventListener);
  }, []);

  // ── Esc to close + lock scroll while open ──────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close]);

  const selectedTemplate = useMemo(
    () => templates?.find((t) => t._id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  // ── Build the live preview (design mode). A selected template shows its saved
  //    HTML instantly; otherwise we ask Brew (which on the client returns the
  //    clean default branded template). designEmail never throws. ─────────────
  useEffect(() => {
    if (!open || mode !== "design") return;

    // A saved template wins — show its branded HTML immediately.
    if (selectedTemplate?.html) {
      setPreviewHtml(selectedTemplate.html);
      setDegraded(false);
      setDesigning(false);
      return;
    }

    let cancelled = false;
    setDesigning(true);
    designEmail({ subject: draft.subject, body: draft.body, brand })
      .then((res) => {
        if (cancelled) return;
        setPreviewHtml(res.html);
        setDegraded(res.degraded);
      })
      .catch(() => {
        if (!cancelled) setPreviewHtml("");
      })
      .finally(() => {
        if (!cancelled) setDesigning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, draft.subject, draft.body, brand, selectedTemplate]);

  const setField = useCallback(
    (field: keyof DraftState) => (value: string) =>
      setDraft((d) => ({ ...d, [field]: value })),
    [],
  );

  const canSend = draft.subject.trim().length > 0 && draft.body.trim().length > 0;

  // ── Actions ────────────────────────────────────────────────────────────────
  const onSaveTemplate = useCallback(async () => {
    const name = templateName.trim();
    if (!name) {
      setNote("Give the template a name first.");
      return;
    }
    if (!previewHtml) {
      setNote("Nothing to save yet.");
      return;
    }
    setBusy("save");
    setNote(null);
    try {
      await saveTemplate({
        name,
        subject: draft.subject.trim() || undefined,
        html: previewHtml,
        body: draft.body.trim() || undefined,
        brand: brand
          ? {
              company: brand.company,
              logoUrl: brand.logoUrl,
              accentHex: brand.accentHex,
              fromName: brand.fromName,
              websiteUrl: brand.websiteUrl,
              footerNote: brand.footerNote,
            }
          : undefined,
      });
      setSavingTemplate(false);
      setTemplateName("");
      setNote("Template saved.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't save the template.");
    } finally {
      setBusy(null);
    }
  }, [templateName, previewHtml, draft.subject, draft.body, brand, saveTemplate]);

  const onSendDesigned = useCallback(async () => {
    if (!canSend) {
      setNote("A subject and body are required to send.");
      return;
    }
    setBusy("designed");
    setNote(null);
    try {
      const res = await sendDesigned({
        to: draft.to.trim() || undefined,
        subject: draft.subject.trim(),
        body: draft.body,
        html: previewHtml || undefined,
        templateId: selectedTemplate?._id,
        emailId,
        runId,
      });
      if (res?.sent) {
        setSent(true);
        setNote(null);
      } else {
        setNote(res?.reason ?? "Send didn't complete — check email settings.");
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(null);
    }
  }, [canSend, draft, previewHtml, selectedTemplate, emailId, runId, sendDesigned]);

  const onSendPlain = useCallback(async () => {
    if (!canSend) {
      setNote("A subject and body are required to send.");
      return;
    }
    setBusy("plain");
    setNote(null);
    try {
      const res = await sendPlain({
        to: draft.to.trim() || undefined,
        subject: draft.subject.trim(),
        body: draft.body,
        emailId,
        runId,
      });
      if (res?.sent) {
        setSent(true);
        setNote(null);
      } else {
        setNote(res?.reason ?? "Send didn't complete — check email settings.");
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(null);
    }
  }, [canSend, draft, emailId, runId, sendPlain]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-scrim/60"
      role="dialog"
      aria-modal="true"
      aria-label="Design email"
      onClick={close}
    >
      <div
        className="relative flex h-full w-full max-w-3xl flex-col overflow-hidden border-l border-hairline bg-canvas shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-4">
          <div className="min-w-0">
            <p className="caption font-mono uppercase text-ink/50">Email designer · Brew</p>
            <h2 className="mt-1 truncate text-lg font-fig-headline text-ink">
              {draft.subject.trim() || "Untitled email"}
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-ink/55">
              {draft.to.trim() ? `to ${draft.to.trim()}` : "recipient resolved at send"}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={!!busy}
            className="shrink-0 rounded-full p-1.5 text-ink/50 transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-40"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        {/* Mode tabs */}
        <div className="flex items-center gap-1 border-b border-hairline px-6 py-2.5">
          {(["design", "plain"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setNote(null);
              }}
              className={cn(
                "rounded-pill px-4 py-1.5 text-[12.5px] font-fig-link transition-colors",
                mode === m
                  ? "bg-ink text-on-primary"
                  : "border border-hairline bg-canvas text-ink hover:bg-surface-soft",
              )}
            >
              {m === "design" ? "Branded design" : "Plain cold email"}
            </button>
          ))}
          {mode === "design" && degraded && (
            <span className="ml-auto caption rounded-full bg-block-cream px-2.5 py-1 text-ink/70">
              preview template · Brew renders on send
            </span>
          )}
        </div>

        {sent ? (
          <SentState onClose={() => setOpen(false)} mode={mode} />
        ) : (
          <>
            {/* Body */}
            <div className="flex min-h-0 flex-1">
              {/* Left — draft fields + templates */}
              <div className="w-2/5 shrink-0 space-y-4 overflow-y-auto border-r border-hairline px-6 py-5">
                <Field label="To">
                  <input
                    type="email"
                    value={draft.to}
                    onChange={(e) => setField("to")(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/35 focus:border-ink/40"
                  />
                </Field>
                <Field label="Subject">
                  <input
                    type="text"
                    value={draft.subject}
                    onChange={(e) => setField("subject")(e.target.value)}
                    placeholder="A short, specific subject"
                    className="w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink/35 focus:border-ink/40"
                  />
                </Field>
                <Field label="Body">
                  <textarea
                    value={draft.body}
                    onChange={(e) => setField("body")(e.target.value)}
                    rows={10}
                    placeholder="Write the cold email…"
                    className="w-full resize-none rounded-md border border-hairline bg-canvas px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink/35 focus:border-ink/40"
                  />
                </Field>

                {mode === "design" && (
                  <div className="space-y-2">
                    <p className="caption font-mono uppercase text-ink/45">Templates</p>
                    <TemplatePicker
                      templates={templates}
                      selectedId={selectedTemplateId}
                      onSelect={(id) =>
                        setSelectedTemplateId((cur) => (cur === id ? null : id))
                      }
                    />
                  </div>
                )}
              </div>

              {/* Right — preview */}
              <div className="flex min-w-0 flex-1 flex-col bg-surface-soft">
                <div className="flex items-center justify-between border-b border-hairline px-5 py-2.5">
                  <span className="caption font-mono uppercase text-ink/45">
                    {mode === "design" ? "Preview" : "Plain text"}
                  </span>
                  {mode === "design" && designing && (
                    <span className="caption text-ink/40">rendering…</span>
                  )}
                </div>
                <div className="min-h-0 flex-1 overflow-hidden p-4">
                  {mode === "design" ? (
                    previewHtml ? (
                      <iframe
                        title="Email preview"
                        srcDoc={previewHtml}
                        sandbox=""
                        className="h-full w-full rounded-md border border-hairline bg-white"
                      />
                    ) : (
                      <div className="grid h-full place-items-center rounded-md border border-dashed border-hairline bg-canvas text-center text-[13px] text-ink/50">
                        {designing ? "Designing your email…" : "Add a subject and body to preview the design."}
                      </div>
                    )
                  ) : (
                    <div className="h-full overflow-y-auto rounded-md border border-hairline bg-canvas p-4">
                      <p className="text-[13px] font-fig-headline text-ink">
                        {draft.subject.trim() || "(no subject)"}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink/75">
                        {draft.body.trim() || "Write the cold email on the left…"}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <footer className="flex flex-wrap items-center gap-3 border-t border-hairline px-6 py-4">
              {mode === "design" && (
                <div className="mr-auto flex items-center gap-2">
                  {savingTemplate ? (
                    <>
                      <input
                        type="text"
                        autoFocus
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        placeholder="Template name"
                        className="w-44 rounded-pill border border-hairline bg-canvas px-3.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink/35 focus:border-ink/40"
                      />
                      <button
                        type="button"
                        onClick={onSaveTemplate}
                        disabled={!!busy || !templateName.trim() || !previewHtml}
                        className="rounded-pill bg-block-mint px-4 py-1.5 text-[12.5px] font-fig-link text-ink transition-colors hover:bg-block-mint/80 disabled:opacity-50"
                      >
                        {busy === "save" ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSavingTemplate(false)}
                        disabled={!!busy}
                        className="text-[12.5px] text-ink/50 hover:text-ink"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSavingTemplate(true);
                        setNote(null);
                      }}
                      disabled={!!busy || !previewHtml}
                      className="rounded-pill border border-hairline bg-canvas px-4 py-2 text-[12.5px] font-fig-link text-ink transition-colors hover:bg-surface-soft disabled:opacity-50"
                    >
                      Save as template
                    </button>
                  )}
                </div>
              )}

              {note && (
                <span className={cn("text-[12px]", mode === "plain" && "mr-auto", "text-ink/55")}>
                  {note}
                </span>
              )}

              <button
                type="button"
                onClick={onSendPlain}
                disabled={!!busy || !canSend}
                className="rounded-pill border border-hairline bg-canvas px-5 py-2 text-[12.5px] font-fig-link text-ink transition-colors hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "plain" ? "Sending…" : "Send plain"}
              </button>

              {mode === "design" && (
                <button
                  type="button"
                  onClick={onSendDesigned}
                  disabled={!!busy || !canSend}
                  className="inline-flex items-center gap-2 rounded-pill bg-primary px-6 py-2 text-[12.5px] font-fig-link text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
                    <path d="m22 2-7 20-4-9-9-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M22 2 11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  {busy === "designed" ? "Sending…" : "Send designed"}
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational pieces.
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="caption font-mono uppercase text-ink/45">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function TemplatePicker({
  templates,
  selectedId,
  onSelect,
}: {
  templates: EmailTemplateDoc[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (templates === undefined) {
    return (
      <div className="space-y-1.5">
        {[0, 1].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-md border border-hairline bg-surface-soft" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-hairline bg-surface-soft px-3 py-2.5 text-[12px] text-ink/50">
        No saved templates yet. Design one and hit “Save as template”.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {templates.map((t) => (
        <button
          key={t._id}
          type="button"
          onClick={() => onSelect(t._id)}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-[12.5px] transition-colors",
            selectedId === t._id
              ? "border-ink/40 bg-block-mint text-ink"
              : "border-hairline bg-canvas text-ink/80 hover:bg-surface-soft",
          )}
        >
          <span className="truncate">{t.name}</span>
          {selectedId === t._id && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20 6 9 17l-5-5" />
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

function SentState({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-block-mint">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <div>
        <h3 className="text-base font-fig-headline text-ink">
          {mode === "design" ? "Designed email sent" : "Plain email sent"}
        </h3>
        <p className="mt-1 text-[13px] text-ink/55">It went out via AgentMail.</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-pill bg-ink px-6 py-2 text-[12.5px] font-fig-link text-on-primary transition-opacity hover:opacity-90"
      >
        Done
      </button>
    </div>
  );
}
