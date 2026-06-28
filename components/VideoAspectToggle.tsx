"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

// ----------------------------------------------------------------------------
// VideoAspectToggle — the generated video ad's ORIENTATION control, a small
// light-Figma segmented pill ("Portrait 9:16 / Landscape 16:9" with tiny frame
// glyphs). Reads the convex `settings` singleton (settings.getSettings →
// videoAspect, default "portrait") and writes settings.setVideoAspect. The
// Creative video lane reads the same setting and threads it to every provider.
// Graceful: a query that hasn't resolved shows the portrait default; the write
// never throws for the caller. Mirrors the AutonomyToggle / TargetChip pattern.
// ----------------------------------------------------------------------------

type AspectOption = "portrait" | "landscape";

const OPTIONS: ReadonlyArray<{
  value: AspectOption;
  label: string;
  ratio: string;
  // SVG frame glyph dims (rounded rect) — tall for portrait, wide for landscape.
  glyph: { x: number; y: number; w: number; h: number };
}> = [
  { value: "portrait", label: "Portrait", ratio: "9:16", glyph: { x: 5, y: 2, w: 6, h: 12 } },
  { value: "landscape", label: "Landscape", ratio: "16:9", glyph: { x: 2, y: 5, w: 12, h: 6 } },
];

function AspectGlyph({ w, h, x, y, active }: { w: number; h: number; x: number; y: number; active: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={1.5}
        stroke="currentColor"
        strokeWidth={1.5}
        className={active ? "text-on-primary" : "text-ink/50"}
      />
    </svg>
  );
}

export default function VideoAspectToggle() {
  const settings = useQuery(api.settings.getSettings, {});
  const setVideoAspect = useMutation(api.settings.setVideoAspect);
  // Default to portrait until the singleton resolves (mirrors the server default).
  const aspect: AspectOption = settings?.videoAspect ?? "portrait";

  const select = (next: AspectOption) => {
    if (next === aspect) return; // no-op when already selected
    void setVideoAspect({ aspect: next }).catch(() => {
      /* setVideoAspect never throws for the caller; ignore defensively */
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label="Video ad orientation"
      title="Orientation for the generated video ad — Portrait (9:16) for feeds, Landscape (16:9) for widescreen."
      className="inline-flex items-center gap-0.5 rounded-pill border border-hairline bg-surface-soft p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === aspect;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${opt.label} ${opt.ratio}`}
            onClick={() => select(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20",
              active ? "bg-primary text-on-primary shadow" : "text-ink/55 hover:text-ink",
            )}
          >
            <AspectGlyph {...opt.glyph} active={active} />
            <span className="font-fig-card text-[12px] tracking-tight">{opt.label}</span>
            <span
              className={cn(
                "font-mono text-[9px] uppercase tracking-wide",
                active ? "text-on-primary/70" : "text-ink/40",
              )}
            >
              {opt.ratio}
            </span>
          </button>
        );
      })}
    </div>
  );
}
