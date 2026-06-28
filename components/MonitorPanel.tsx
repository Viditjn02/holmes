"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// ============================================================================
// MonitorPanel — "Watch this company 24/7".
//
// Standalone, self-contained panel the integrator can mount anywhere. It lets a
// user stand up a 24/7 monitor (api.monitor.createMonitor) and reactively lists
// active monitors (api.monitor.listMonitors) with pause/resume + "last checked".
// A Convex cron re-runs the swarm on each monitor's cadence; every newly found
// buyer still lands in the human approval queue.
//
// GRACEFUL: never throws. Submit failures surface a quiet inline hint.
//
//   import MonitorPanel from "@/components/MonitorPanel";
//   <MonitorPanel />
// ============================================================================

const INPUT_TYPES = [
  { value: "name", label: "Company name" },
  { value: "url", label: "Website URL" },
  { value: "competitor", label: "Competitor" },
  { value: "community", label: "Community" },
  { value: "text", label: "Freeform" },
] as const;

type InputType = (typeof INPUT_TYPES)[number]["value"];

const CADENCES = [
  { value: 60, label: "Hourly" },
  { value: 360, label: "Every 6h" },
  { value: 1440, label: "Daily" },
] as const;

function lastChecked(lastRunAt: number | undefined): string {
  if (lastRunAt == null) return "not yet checked";
  const diffMs = Date.now() - lastRunAt;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "checked just now";
  if (mins < 60) return `checked ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `checked ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `checked ${days}d ago`;
}

function cadenceLabel(cadenceMinutes: number): string {
  const match = CADENCES.find((c) => c.value === cadenceMinutes);
  if (match) return match.label;
  if (cadenceMinutes % 1440 === 0) return `every ${cadenceMinutes / 1440}d`;
  if (cadenceMinutes % 60 === 0) return `every ${cadenceMinutes / 60}h`;
  return `every ${cadenceMinutes}m`;
}

export default function MonitorPanel() {
  const monitors = useQuery(api.monitor.listMonitors, {});
  const createMonitor = useMutation(api.monitor.createMonitor);
  const toggleMonitor = useMutation(api.monitor.toggleMonitor);

  const [company, setCompany] = useState("");
  const [input, setInput] = useState("");
  const [inputType, setInputType] = useState<InputType>("name");
  const [cadenceMinutes, setCadenceMinutes] = useState<number>(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedInput = input.trim();
      if (submitting || trimmedInput.length === 0) return;
      setSubmitting(true);
      setError(null);
      try {
        await createMonitor({
          company: company.trim(),
          input: trimmedInput,
          inputType,
          cadenceMinutes,
        });
        setCompany("");
        setInput("");
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Couldn't start the monitor.",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [company, input, inputType, cadenceMinutes, submitting, createMonitor],
  );

  const onToggle = useCallback(
    async (monitorId: Id<"monitors">, active: boolean) => {
      try {
        await toggleMonitor({ monitorId, active });
      } catch {
        // Reactive query will reconcile; nothing to surface.
      }
    },
    [toggleMonitor],
  );

  const activeCount = (monitors ?? []).filter((m) => m.active).length;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-panel/60">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span aria-hidden className="text-base leading-none">
          📡
        </span>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Watch this company 24/7
          </h3>
          <p className="text-[11px] text-zinc-500">
            Autonomous discovery 24/7 — every new buyer still lands in your
            approval queue.
          </p>
        </div>
        {activeCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-good/15 px-2.5 py-1 text-[11px] font-semibold text-good ring-1 ring-good/30">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" />
            {activeCount} live
          </span>
        )}
      </header>

      <form onSubmit={onSubmit} className="space-y-3 px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-500">
              Company
            </span>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Superhuman"
              className="rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent/60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-500">
              Watch target
            </span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="superhuman.com"
              required
              className="rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-accent/60"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-500">Type</span>
            <select
              value={inputType}
              onChange={(e) => setInputType(e.target.value as InputType)}
              className="rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent/60"
            >
              {INPUT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-zinc-500">
              Cadence
            </span>
            <select
              value={cadenceMinutes}
              onChange={(e) => setCadenceMinutes(Number(e.target.value))}
              className="rounded-lg border border-line bg-ink/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent/60"
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting || input.trim().length === 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-ink transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Starting watch…" : "Watch this company 24/7"}
        </button>

        {error && <p className="text-xs text-zinc-500">{error}</p>}
      </form>

      {monitors && monitors.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {monitors.map((monitor) => (
            <li
              key={monitor._id}
              className="flex items-center gap-3 px-5 py-3"
            >
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${
                  monitor.active
                    ? "animate-pulse bg-good"
                    : "bg-zinc-600"
                }`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {monitor.company}
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  {cadenceLabel(monitor.cadenceMinutes)} ·{" "}
                  {lastChecked(monitor.lastRunAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onToggle(monitor._id, !monitor.active)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ${
                  monitor.active
                    ? "bg-transparent text-zinc-400 ring-line hover:text-zinc-200"
                    : "bg-good/15 text-good ring-good/30 hover:bg-good/25"
                }`}
              >
                {monitor.active ? "Pause" : "Resume"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
