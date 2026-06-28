"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

// ============================================================================
// ProjectGallery — GitHub artifact intelligence (scout).
//
// Point INTERCEPT at an event / hackathon / GitHub org / topic and it enumerates
// the REAL projects being built there. Each card is an HONEST teardown: what
// they're building, the stack, maturity, GTM-style pros/cons, plus confidence +
// provenance (how the repo was matched) and a "view repo" link. Empty/placeholder
// repos are LABELED, never hallucinated. Public-data only.
//
// Backend (scout agent / convex/projects.ts):
//   api.projects.listByRun({ runId }) : Doc<"projects">[]   (populated-first)
// ============================================================================

interface ProjectGalleryProps {
  runId: Id<"runs">;
}

// Maturity → label + block tint. Tints stay inside the pastel palette.
const MATURITY_META: Record<string, { label: string; chip: string }> = {
  empty: { label: "Empty repo", chip: "bg-surface-soft text-ink/70" },
  placeholder: { label: "Placeholder", chip: "bg-surface-soft text-ink/70" },
  prototype: { label: "Prototype", chip: "bg-block-cream text-ink" },
  mvp: { label: "MVP", chip: "bg-block-lime text-ink" },
  production: { label: "Production", chip: "bg-block-mint text-ink" },
};

function maturityMeta(m: string) {
  return MATURITY_META[m] ?? { label: m || "Unknown", chip: "bg-surface-soft text-ink/70" };
}

/** Confidence → a calm, honest dot tier. */
function confidenceChip(c: number): { label: string; cls: string } {
  if (c >= 0.7) return { label: "High confidence", cls: "bg-success" };
  if (c >= 0.45) return { label: "Medium confidence", cls: "bg-block-lime" };
  return { label: "Low confidence", cls: "bg-block-cream" };
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const { label, cls } = confidenceChip(confidence);
  return (
    <span
      className="caption inline-flex items-center gap-1.5 rounded-pill bg-surface-soft px-2 py-0.5 text-ink/70"
      title={`Analysis confidence ${(confidence * 100).toFixed(0)}% — judged only from public README + repo metadata`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cls}`} aria-hidden />
      {label} · {(confidence * 100).toFixed(0)}%
    </span>
  );
}

function StackChips({ stack }: { stack: string[] }) {
  if (stack.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {stack.slice(0, 8).map((s) => (
        <span
          key={s}
          className="caption rounded-pill border border-hairline bg-canvas px-2 py-0.5 text-ink/80"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function ProsCons({ pros, cons }: { pros: string[]; cons: string[] }) {
  if (pros.length === 0 && cons.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {pros.length > 0 && (
        <div>
          <p className="eyebrow mb-1 text-[10.5px] text-ink/55">Strengths</p>
          <ul className="space-y-1">
            {pros.slice(0, 4).map((p, i) => (
              <li key={i} className="flex gap-1.5 text-body-sm leading-snug text-ink/85">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {cons.length > 0 && (
        <div>
          <p className="eyebrow mb-1 text-[10.5px] text-ink/55">Gaps / risks</p>
          <ul className="space-y-1">
            {cons.slice(0, 4).map((c, i) => (
              <li key={i} className="flex gap-1.5 text-body-sm leading-snug text-ink/85">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-magenta" aria-hidden />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ p }: { p: Doc<"projects"> }) {
  const mat = maturityMeta(p.maturity);
  const team = p.team ?? [];

  return (
    <article
      className={`flex flex-col gap-3 rounded-lg border bg-canvas p-4 ${
        p.isEmpty ? "border-dashed border-hairline opacity-90" : "border-hairline"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-body font-fig-headline text-ink">{p.project}</h4>
            <span className={`caption whitespace-nowrap rounded-pill px-2 py-0.5 ${mat.chip}`}>
              {mat.label}
            </span>
          </div>
          <p className="truncate font-fig-mono text-[11px] text-ink/45">{p.repoFullName}</p>
        </div>
        {typeof p.stars === "number" && p.stars > 0 && (
          <span className="caption inline-flex items-center gap-1 whitespace-nowrap rounded-pill bg-surface-soft px-2 py-0.5 text-ink/70">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z" />
            </svg>
            {p.stars}
          </span>
        )}
      </div>

      {p.isEmpty ? (
        <p className="rounded-md bg-surface-soft px-3 py-2 text-body-sm leading-snug text-ink/70">
          {p.whatTheyreBuilding}
        </p>
      ) : (
        <p className="text-body-sm leading-relaxed text-ink/85">{p.whatTheyreBuilding}</p>
      )}

      <StackChips stack={p.stack ?? []} />
      <ProsCons pros={p.pros ?? []} cons={p.cons ?? []} />

      {p.gtmAngle && (
        <p className="rounded-md bg-block-lime px-2.5 py-1.5 text-body-sm leading-snug text-ink">
          <span className="eyebrow mr-1 text-[11px]">GTM angle</span>
          {p.gtmAngle}
        </p>
      )}

      {/* provenance + confidence (honesty rail) */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ConfidenceBadge confidence={p.confidence} />
        <span className="caption rounded-pill bg-surface-soft px-2 py-0.5 text-ink/60">
          Matched on {p.matchedOn}
        </span>
        {team.length > 0 && (
          <span className="caption rounded-pill bg-surface-soft px-2 py-0.5 text-ink/60">
            {team.length} contributor{team.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* team handles (public, from the contributors API) */}
      {team.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {team.slice(0, 6).map((m) => (
            <a
              key={m.login}
              href={m.url ?? `https://github.com/${m.login}`}
              target="_blank"
              rel="noopener noreferrer"
              className="caption rounded-pill border border-hairline bg-canvas px-2 py-0.5 text-ink/70 transition-colors hover:bg-surface-soft"
            >
              @{m.login}
            </a>
          ))}
        </div>
      )}

      <div className="mt-1 flex items-center justify-between gap-2 border-t border-hairline pt-3">
        {p.updatedAtGh && (
          <span className="caption text-ink/45">
            Pushed {new Date(p.updatedAtGh).toLocaleDateString()}
          </span>
        )}
        <a
          href={p.repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-pill border border-hairline bg-canvas px-3 py-1.5 text-body-sm font-fig-link text-ink transition-colors hover:bg-surface-soft"
        >
          View repo
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 17 17 7" />
            <path d="M7 7h10v10" />
          </svg>
        </a>
      </div>
    </article>
  );
}

export default function ProjectGallery({ runId }: ProjectGalleryProps) {
  const projects = useQuery(api.projects.listByRun, { runId });
  const loading = projects === undefined;

  return (
    <section className="overflow-hidden rounded-lg border border-hairline bg-canvas">
      <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
        <div>
          <h3 className="text-headline text-ink">What everyone&apos;s building</h3>
          <p className="text-body-sm text-ink/60">
            Real GitHub projects — discovered, enumerated, and dissected. Public data only.
          </p>
        </div>
        {!loading && projects.length > 0 && (
          <span className="caption rounded-pill bg-surface-soft px-2.5 py-1 text-ink">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </span>
        )}
      </header>

      <div className="p-4">
        {loading ? (
          <div className="grid place-items-center py-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="relative h-10 w-10">
                <span className="absolute inset-0 animate-spin rounded-full border-2 border-hairline border-t-ink" />
                <span className="absolute inset-2 rounded-full bg-surface-soft" />
              </div>
              <p className="text-body-sm text-ink/70">Scouting GitHub and reading each repo…</p>
            </div>
          </div>
        ) : projects.length === 0 ? (
          <div className="grid place-items-center py-10 text-center">
            <p className="text-body-sm text-ink/70">No public projects surfaced yet.</p>
            <p className="mt-1 max-w-md text-body-sm text-ink/50">
              We searched GitHub for self-published repos matching this event/org/topic (token-optional). Try a more
              distinctive name, a GitHub org (e.g. <span className="font-fig-mono">github.com/orgs/vercel</span>), or a
              topic. We only ever read public artifacts — never a private attendee list.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {projects.map((p) => (
              <ProjectCard key={p._id} p={p} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
