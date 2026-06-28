"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { OnboardingStep } from "@/lib/contract";
import { buildChecklist } from "@/lib/onboarding/flow";

// ============================================================================
// OnboardingCanvas — TRACK 3 (zero-to-one PLG) canvas panel.
//
// Reads api.agents.guide.flowForRun({ runId }) and renders:
//   • a stepper preview of the generated tour (the activation flow),
//   • a MOCK app frame with a Shepherd-styled tooltip walking the steps
//     (Back / Next, progress dots) so you can SEE the tour live,
//   • a paste-ready embed-snippet block with a Copy button.
// Loading + empty states match the rest of the canvas.
// ============================================================================

interface OnboardingCanvasProps {
  runId: Id<"runs">;
}

const PLACEMENT_LABEL: Record<string, string> = {
  top: "above",
  bottom: "below",
  left: "left of",
  right: "right of",
  center: "centered on",
};

export default function OnboardingCanvas({ runId }: OnboardingCanvasProps) {
  const flow = useQuery(api.agents.guide.flowForRun, { runId });

  const steps = useMemo<OnboardingStep[]>(() => {
    if (!flow) return [];
    return [...flow.tourSteps]
      .map((s) => ({
        order: s.order,
        target: s.target,
        title: s.title,
        body: s.body,
        placement: s.placement,
        cta: s.cta,
      }))
      .sort((a, b) => a.order - b.order);
  }, [flow]);

  // Loading — the guide hasn't written its row yet.
  if (flow === undefined) {
    return (
      <Shell>
        <p className="mt-1 text-[13px] text-ink/50">
          Designing your in-app onboarding tour…
        </p>
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-9 animate-pulse rounded-md border border-hairline bg-surface-soft"
            />
          ))}
        </div>
      </Shell>
    );
  }

  // Empty — no flow generated (e.g. a non-onboarding run focused here).
  if (flow === null || steps.length === 0) {
    return (
      <Shell>
        <p className="mt-1 text-[13px] text-ink/50">
          A generated product tour + paste-ready embed snippet will render here.
        </p>
      </Shell>
    );
  }

  return (
    <section className="rounded-lg border border-hairline bg-canvas p-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="caption text-ink/60">
            Onboarding flow
          </p>
          <h3 className="mt-0.5 text-sm font-fig-headline text-ink">
            {flow.productName} — first-run product tour
          </h3>
        </div>
        <span className="caption rounded-full border border-hairline bg-surface-soft px-2.5 py-1 text-ink">
          {flow.framework === "onboardjs" ? "OnboardJS" : "Shepherd.js"} · {steps.length} steps
        </span>
      </header>

      <LiveTour steps={steps} productName={flow.productName} />
      <Stepper steps={steps} />
      <Checklist steps={steps} />
      <EmbedBlock snippet={flow.embedSnippet} />
    </section>
  );
}

// ----------------------------------------------------------------------------
// Shell — shared chrome for loading/empty states.
// ----------------------------------------------------------------------------
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-canvas p-4">
      <p className="caption text-ink/60">
        Onboarding flow
      </p>
      {children}
    </div>
  );
}

// ----------------------------------------------------------------------------
// LiveTour — a mock app frame with a Shepherd-styled tooltip walking the steps.
// ----------------------------------------------------------------------------
function LiveTour({
  steps,
  productName,
}: {
  steps: OnboardingStep[];
  productName: string;
}) {
  const [active, setActive] = useState(0);
  const step = steps[Math.min(active, steps.length - 1)];
  const isFirst = active === 0;
  const isLast = active === steps.length - 1;
  const placement = PLACEMENT_LABEL[step.placement] ?? "near";

  return (
    <div className="mt-4">
      {/* faux browser chrome */}
      <div className="overflow-hidden rounded-md border border-hairline bg-surface-soft">
        <div className="flex items-center gap-1.5 border-b border-hairline bg-canvas px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
          <span className="ml-2 truncate text-[11px] text-ink/40">
            {productName.toLowerCase().replace(/\s+/g, "")}.app
          </span>
        </div>

        {/* mock app body with a modal-overlay spotlight + tooltip */}
        <div className="relative min-h-[190px] bg-surface-soft p-4">
          {/* faux layout the tour points at */}
          <div className="pointer-events-none flex gap-3 opacity-50">
            <div className="h-[150px] w-24 rounded-md border border-hairline bg-canvas" />
            <div className="flex-1 space-y-2">
              <div className="h-6 w-1/3 rounded bg-ink/5" />
              <div className="h-20 rounded-md border border-hairline bg-canvas" />
              <div className="h-6 w-2/3 rounded bg-ink/5" />
            </div>
          </div>

          {/* Shepherd-styled tooltip */}
          <div className="absolute inset-x-4 bottom-4 rounded-md border border-hairline bg-canvas p-3 shadow-soft">
            <div className="flex items-center justify-between gap-2">
              <span className="caption truncate rounded-sm bg-block-lilac px-1.5 py-0.5 text-ink">
                {placement} <span className="text-ink/60">{step.target}</span>
              </span>
              <span className="flex-none text-[10px] text-ink/40">
                Step {active + 1} / {steps.length}
              </span>
            </div>
            <h4 className="mt-2 text-[13px] font-fig-headline text-ink">
              {step.title}
            </h4>
            <p className="mt-1 text-[12px] leading-snug text-ink/60">
              {step.body}
            </p>
            <div className="mt-3 flex items-center justify-between">
              <div className="flex gap-1">
                {steps.map((s, i) => (
                  <button
                    key={s.order}
                    aria-label={`Go to step ${i + 1}`}
                    onClick={() => setActive(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === active ? "w-4 bg-ink" : "w-1.5 bg-ink/20"
                    }`}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  disabled={isFirst}
                  onClick={() => setActive((i) => Math.max(0, i - 1))}
                  className="rounded-pill border border-hairline bg-canvas px-3 py-1 text-[11px] font-fig-link text-ink/70 transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-30"
                >
                  Back
                </button>
                <button
                  onClick={() =>
                    setActive((i) => (isLast ? 0 : Math.min(steps.length - 1, i + 1)))
                  }
                  className="rounded-pill bg-primary px-3 py-1 text-[11px] font-fig-link text-on-primary transition-opacity hover:opacity-90"
                >
                  {isLast ? "Restart" : step.cta || "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Stepper — the full flow at a glance.
// ----------------------------------------------------------------------------
function Stepper({ steps }: { steps: OnboardingStep[] }) {
  return (
    <div className="mt-4">
      <p className="caption mb-2 text-ink/40">
        Activation flow
      </p>
      <ol className="space-y-1.5">
        {steps.map((s) => (
          <li
            key={s.order}
            className="flex gap-2.5 rounded-md border border-hairline bg-surface-soft p-2.5"
          >
            <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-block-lilac text-[11px] font-fig-headline text-ink">
              {s.order}
            </span>
            <div className="min-w-0">
              <p className="text-[12px] font-fig-headline text-ink">{s.title}</p>
              <p className="truncate text-[11px] text-ink/50">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Checklist — the OnboardJS-derived activation checklist (a second PLG surface).
// ----------------------------------------------------------------------------
function Checklist({ steps }: { steps: OnboardingStep[] }) {
  const items = useMemo(() => buildChecklist(steps), [steps]);
  return (
    <div className="mt-4">
      <p className="caption mb-2 text-ink/40">
        Activation checklist
      </p>
      <ul className="space-y-1">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-2 text-[12px] text-ink/70">
            <span
              className={`flex h-4 w-4 flex-none items-center justify-center rounded-sm border text-[9px] ${
                it.isMandatory
                  ? "border-success/50 text-success"
                  : "border-hairline text-ink/30"
              }`}
            >
              ✓
            </span>
            <span className="truncate">{it.label}</span>
            {it.isMandatory && (
              <span className="caption ml-auto flex-none text-ink/50">
                core
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------------
// EmbedBlock — the paste-ready snippet + a Copy button.
// ----------------------------------------------------------------------------
function EmbedBlock({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);

  if (!snippet) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="caption text-ink/40">
          Paste-ready embed
        </p>
        <button
          onClick={copy}
          className={`rounded-pill border px-3 py-0.5 text-[11px] font-fig-link transition-colors ${
            copied
              ? "border-hairline bg-block-mint text-ink"
              : "border-hairline bg-canvas text-ink hover:bg-surface-soft"
          }`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-44 overflow-auto rounded-md border border-hairline bg-surface-soft p-3 font-mono text-[10px] leading-relaxed text-ink/70">
        {snippet}
      </pre>
    </div>
  );
}
