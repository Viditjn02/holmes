"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// ============================================================================
// CreativePanel — the generated Veo video ad.
// Renders the finished clip, or a graceful "rendering" state while the creative
// agent is still working.
//
// Expected backend (owned by the creative agent):
//   api.brief.getCreative({ runId }) : Doc<"creatives"> | null
// ============================================================================

interface CreativePanelProps {
  runId: Id<"runs">;
}

export default function CreativePanel({ runId }: CreativePanelProps) {
  const creative = useQuery(api.brief.getCreative, { runId });

  const loading = creative === undefined;
  const status = creative?.status;
  const playbackUrl = creative?.storageUrl ?? creative?.url ?? null;
  const ready = status === "done" && !!playbackUrl;
  const failed = status === "failed";

  return (
    <section className="overflow-hidden rounded-lg border border-hairline bg-canvas">
      <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
        <div>
          <h3 className="text-headline text-ink">Generated video ad</h3>
          <p className="text-body-sm text-ink/60">
            {creative?.model ? `Rendered with ${creative.model}` : "Veo creative"}
          </p>
        </div>
        {status && (
          <span
            className={`caption inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 ${
              ready
                ? "bg-block-mint text-ink"
                : failed
                  ? "bg-block-pink text-red-500"
                  : "bg-surface-soft text-ink"
            }`}
          >
            {ready && <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />}
            {ready ? "Ready" : failed ? "Failed" : "Rendering"}
          </span>
        )}
      </header>

      <div className="aspect-video w-full bg-surface-soft">
        {ready ? (
          <video
            key={playbackUrl}
            src={playbackUrl ?? undefined}
            controls
            playsInline
            poster={undefined}
            className="h-full w-full object-contain"
          >
            Your browser does not support embedded video.
          </video>
        ) : (
          <div className="grid h-full w-full place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
              {failed ? (
                <>
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-block-pink text-red-500">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                    </svg>
                  </div>
                  <p className="text-body-sm text-ink/70">Video render failed.</p>
                </>
              ) : (
                <>
                  <div className="relative h-12 w-12">
                    <span className="absolute inset-0 animate-spin rounded-full border-2 border-hairline border-t-ink" />
                    <span className="absolute inset-2 rounded-full bg-canvas" />
                  </div>
                  <p className="text-body-sm text-ink/70">
                    {loading ? "Loading creative…" : "Rendering your video ad…"}
                  </p>
                  <p className="max-w-xs text-body-sm text-ink/50">
                    Veo is generating a short ad from the positioning. This appears the moment it
                    finishes.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
