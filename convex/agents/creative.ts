// ============================================================================
// INTERCEPT — CREATIVE AGENT (provider-agnostic video ad)
//
// Kicked EARLY by the orchestrator so the render lands before the fan-in
// deadline. It reads whatever the swarm has produced so far (brief, company,
// and the buyers' own language from `threads` — the moat) and turns that into a
// short, cinematic ad prompt, then renders it through a SWAPPABLE provider chain
// that picks the FIRST provider whose key/precondition is present:
//
//   1. WaveSpeed LTX-2.3 (WAVESPEED_API_KEY) — plain HTTPS, works DEPLOYED;
//      image-to-video on the gpt-image-1 ad poster.            (lib/wavespeed.ts)
//   2. Veo          (GOOGLE_API_KEY)   ─┐ text-to-video, inside lib/veo.generateAd
//   3. fal LTX      (FAL_KEY)          ─┘ (Veo → fal fallback chain)
//   4. local Ken-Burns worker (VIDEO_WORKER_URL) — $0, localhost only.
//   5. none → the static gpt-image-1 ad ("preview"; graceful, never a red fail).
//
// So setting ANY one key yields a video. The chosen ASPECT (landscape/portrait,
// from lib/contract) is threaded through every provider + the worker.
//
// Persistence is owned by THIS file (per the swarm convention): a single
// `video` row in `creatives`, flipped rendering -> done(+url) | failed. The
// agent NEVER throws past its own handler — a failed render must never block
// the run (the brief renders regardless of the creative).
//
// NOTE: this file is intentionally NOT "use node". It defines internalMutation
// + internalQuery alongside the action (Convex forbids mutations/queries in a
// "use node" module). lib/veo.generateAd performs its HTTP work via fetch, so
// it runs fine in the default Convex action runtime.
//
// Expected contract from lib/veo.ts (owned by the clients lane):
//   export interface GenerateAdInput { prompt: string; aspectRatio?: string; durationSeconds?: number }
//   export interface GenerateAdResult { url: string; model?: string }
//   export function generateAd(input: GenerateAdInput): Promise<GenerateAdResult>
// ============================================================================

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  MAX_THREADS,
  DEFAULT_AD_ASPECT,
  aspectRatioFor,
  type AdAspect,
  type AspectRatio,
} from "../../lib/contract";
import { generateAd } from "../../lib/veo";
import { generateVideoFromImage } from "../../lib/wavespeed";
import { renderVideo } from "../../lib/videoWorker";

const VEO_MODEL = "veo-3.1-fast";
const WAVESPEED_MODEL = "wavespeed-ltx-2.3";
const AD_DURATION_SECONDS = 8;

// ----------------------------------------------------------------------------
// Aspect option (landscape "16:9" / portrait "9:16") is now a persisted USER
// TOGGLE on the settings singleton (settings.getSettings → videoAspect), not a
// module constant. The `run` action reads it and threads the resolved
// AspectRatio through every provider + the local worker. Graceful: a missing
// setting / query failure degrades to the portrait default — never throws.
// ----------------------------------------------------------------------------
async function readVideoAspect(ctx: ActionCtx): Promise<AdAspect> {
  try {
    const settings = await ctx.runQuery(api.settings.getSettings, {});
    return settings?.videoAspect ?? DEFAULT_AD_ASPECT;
  } catch {
    return DEFAULT_AD_ASPECT;
  }
}

// ----------------------------------------------------------------------------
// READ: gather everything the swarm has produced so far for this run.
// Tolerant by design — creative is kicked early, so brief/threads may be empty.
// ----------------------------------------------------------------------------
export const context = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    const brief = await ctx.db
      .query("brief")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first();
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .order("desc")
      .take(MAX_THREADS);
    // Optional competitor-reel insight produced by the watcher agent.
    const creatives = await ctx.db
      .query("creatives")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .collect();
    const reelInsight = creatives.find((c) => c.kind === "reel-analysis");

    // The already-generated gpt-image-1 ad image (same poster brief.getCreative
    // exposes). Passing it to the free worker triggers the KEN-BURNS FAST PATH —
    // animating that one image in seconds instead of downloading Pexels clips.
    // Best-effort: null just means the worker uses its Pexels fallback.
    let posterUrl: string | null = null;
    try {
      const ads = await ctx.db
        .query("adCreatives")
        .withIndex("by_run", (q) => q.eq("runId", runId))
        .collect();
      const withImage = ads.find((a) => a.imageStatus === "done" && !!a.imageUrl);
      posterUrl = withImage?.imageUrl ?? null;
    } catch {
      posterUrl = null;
    }

    return {
      company: run?.company ?? run?.input ?? "the company",
      input: run?.input ?? "",
      icp: brief?.icp ?? "",
      positioning: brief?.positioning ?? "",
      threads: threads.map((t) => ({
        title: t.title,
        snippet: t.snippet,
        intentLabel: t.intentLabel,
      })),
      reelInsight: reelInsight?.prompt ?? null,
      posterUrl,
    };
  },
});

// ----------------------------------------------------------------------------
// WRITE: upsert the single `video` creative row for this run.
// ----------------------------------------------------------------------------
export const save = internalMutation({
  args: {
    runId: v.id("runs"),
    status: v.union(
      v.literal("pending"),
      v.literal("rendering"),
      v.literal("done"),
      v.literal("preview"), // calm graceful-degrade (no video) — never a red error
      v.literal("failed"),
    ),
    prompt: v.string(),
    model: v.string(),
    url: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const existing = (
      await ctx.db
        .query("creatives")
        .withIndex("by_run", (q) => q.eq("runId", args.runId))
        .collect()
    ).find((c) => c.kind === "video");

    const fields = {
      kind: "video" as const,
      status: args.status,
      prompt: args.prompt,
      model: args.model,
      url: args.url,
      storageId: args.storageId,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("creatives", { runId: args.runId, ...fields });
  },
});

// ----------------------------------------------------------------------------
// ACTION: build the prompt, render the ad, persist. Never blocks the run.
// ----------------------------------------------------------------------------
export const run = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const data = await ctx.runQuery(internal.agents.creative.context, { runId });

    // The persisted USER TOGGLE — portrait (9:16) / landscape (16:9). Resolved to
    // the wire AspectRatio threaded through every provider + the worker. Graceful
    // default portrait when the setting is unset or the query fails.
    const aspect = await readVideoAspect(ctx);
    const ratio: AspectRatio = aspectRatioFor(aspect);
    const prompt = buildAdPrompt(data, ratio);

    // Mark rendering immediately so the live board reflects the early kick.
    await ctx.runMutation(internal.agents.creative.save, {
      runId,
      status: "rendering",
      prompt,
      model: VEO_MODEL,
    });
    await logEvent(ctx, runId, "rendered", `Rendering a video ad for ${data.company}…`);

    // PROVIDER CHAIN — pick the FIRST provider whose key/precondition is present,
    // falling through gracefully on a miss. Setting ANY one key yields a video.
    try {
      // 1) WaveSpeed LTX-2.3 (WAVESPEED_API_KEY) — plain HTTPS, works DEPLOYED.
      //    Animates the gpt-image-1 ad poster (image-to-video). Needs the poster.
      const ws = await tryWavespeed(data, prompt, ratio, AD_DURATION_SECONDS);
      if (ws) {
        await persistExternalVideo(ctx, runId, prompt, ws.model, ws.url);
        return;
      }

      // 2 + 3) Veo (GOOGLE_API_KEY) → fal LTX (FAL_KEY), text-to-video, inside the
      //    multi-provider client. Returns { url: undefined } (no throw) on a miss.
      const result = await generateAd({
        prompt,
        aspectRatio: ratio,
        durationSeconds: AD_DURATION_SECONDS,
      });
      if (result.url) {
        await persistExternalVideo(ctx, runId, prompt, result.model ?? VEO_MODEL, result.url);
        return;
      }

      // 4) FREE local Ken-Burns worker (VIDEO_WORKER_URL) — $0, localhost only, so
      //    it's the LAST resort (it can't run from a deployed Convex action).
      const free = await tryFreeWorker(ctx, runId, data, prompt, ratio);
      if (free) {
        await ctx.runMutation(internal.agents.creative.save, {
          runId,
          status: "done",
          prompt,
          model: free.model,
          url: free.url,
          storageId: free.storageId,
        });
        await logEvent(ctx, runId, "rendered", `Video ad ready (free ${free.model}).`);
        return;
      }

      // 5) No provider configured/usable. GRACEFUL DEGRADE: mark "preview" — the
      //    panel calmly shows the static gpt-image-1 ad image (from adsmith) or a
      //    "video preview · queued" card. NEVER a red "failed" — the brief stays green.
      await ctx.runMutation(internal.agents.creative.save, {
        runId,
        status: "preview",
        prompt,
        model: result.model ?? VEO_MODEL,
      });
      await logEvent(
        ctx,
        runId,
        "rendered",
        "Video preview queued — showing the static ad while a render warms up.",
      );
    } catch {
      // Any provider threw — GRACEFUL DEGRADE to the calm "preview" state (never
      // red). The fan-in still ships the brief; the panel falls back to the static
      // gpt-image-1 ad image or a "video preview · queued" card.
      await ctx.runMutation(internal.agents.creative.save, {
        runId,
        status: "preview",
        prompt,
        model: VEO_MODEL,
      });
      await logEvent(
        ctx,
        runId,
        "rendered",
        "Video preview queued — the static ad is live; the rest of the brief is unaffected.",
      );
    }
  },
});

// ----------------------------------------------------------------------------
// PROVIDER 1 — WaveSpeed LTX-2.3 (HTTPS, deploy-safe). Animates the gpt-image-1
// ad poster into a short clip (image-to-video). Returns null (never throws) when
// there's no poster, no WAVESPEED_API_KEY, or the render fails — the chain then
// falls through to Veo / fal / the local worker. Aspect is threaded through.
// ----------------------------------------------------------------------------
async function tryWavespeed(
  data: AdContext,
  prompt: string,
  ratio: AspectRatio,
  durationSeconds: number,
): Promise<{ url: string; model: string } | null> {
  // image-to-video needs the already-generated poster image. None ⇒ skip.
  if (!data.posterUrl) return null;
  const url = await generateVideoFromImage({
    imageUrl: data.posterUrl,
    prompt,
    aspect: ratio,
    duration: durationSeconds,
  });
  return url ? { url, model: WAVESPEED_MODEL } : null;
}

// ----------------------------------------------------------------------------
// Persist an externally-hosted clip (WaveSpeed / Veo / fal) to Convex File
// Storage (SSRF-guarded, "use node"), then save the "done" creative row. Storage
// failure never blocks the run — the external URL is the fallback.
// ----------------------------------------------------------------------------
async function persistExternalVideo(
  ctx: ActionCtx,
  runId: Id<"runs">,
  prompt: string,
  model: string,
  url: string,
): Promise<void> {
  let storageId: Id<"_storage"> | undefined;
  try {
    const stored = await ctx.runAction(internal.storage.storeFromUrl, { url });
    storageId = stored.storageId;
  } catch {
    storageId = undefined;
  }
  await ctx.runMutation(internal.agents.creative.save, {
    runId,
    status: "done",
    prompt,
    model,
    url,
    storageId,
  });
  await logEvent(ctx, runId, "rendered", `Video ad ready (${model}).`);
}

// ----------------------------------------------------------------------------
// FREE video worker bridge. Builds short ad scenes from the
// brief + buyer language, renders via the local worker, stores the returned MP4
// into Convex storage. Returns null (never throws) when the worker is down or
// degrades — the caller then falls back to the Veo render. The free path is $0.
// ----------------------------------------------------------------------------
async function tryFreeWorker(
  ctx: ActionCtx,
  runId: Id<"runs">,
  data: AdContext,
  prompt: string,
  ratio: AspectRatio,
): Promise<{ url?: string; storageId?: Id<"_storage">; model: string } | null> {
  try {
    const result = await renderVideo({
      topic: data.company,
      script: prompt,
      scenes: buildAdScenes(data),
      aspectRatio: ratio,
      durationSeconds: AD_DURATION_SECONDS,
      // Hand the gpt-image-1 ad image to the worker → KEN-BURNS FAST PATH
      // (animate the image in seconds). Absent ⇒ worker uses Pexels. Graceful.
      ...(data.posterUrl ? { posterUrl: data.posterUrl } : {}),
    });
    if (!result.ok || !result.videoBase64) return null;

    const stored = await ctx.runAction(internal.storage.storeFromBase64, {
      base64: result.videoBase64,
      contentType: result.contentType ?? "video/mp4",
    });
    return { url: stored.url ?? result.url, storageId: stored.storageId, model: result.model };
  } catch {
    return null; // any failure → fall back to Veo
  }
}

// Turn the brief + buyers' own language into a few captioned ad scenes (each a
// narration line + a stock-footage search query) for the free worker.
function buildAdScenes(data: AdContext): { text: string; query: string }[] {
  const { company, icp, positioning, threads } = data;
  const audience = icp.trim() || "teams";
  const painLine =
    threads[0]?.title?.trim() || `${audience} waste hours on the same frustrating problem.`;
  const valueLine =
    positioning.trim() || `${company} makes it effortless — the modern way to get it done.`;

  return [
    { text: painLine, query: `${audience} frustrated work` },
    { text: `There's a better way.`, query: `idea solution technology` },
    { text: valueLine, query: `${company} product modern office` },
    { text: `Meet ${company}.`, query: `success team celebration` },
  ];
}

// ----------------------------------------------------------------------------
// Append one line to the live activity feed. Best-effort — a feed write must
// never block the creative lane.
// ----------------------------------------------------------------------------
async function logEvent(
  ctx: ActionCtx,
  runId: Id<"runs">,
  kind: string,
  message: string,
): Promise<void> {
  try {
    await ctx.runMutation(internal.events.log, {
      runId,
      agent: "creative",
      kind,
      message,
    });
  } catch {
    // ignore — the feed is additive
  }
}

// ----------------------------------------------------------------------------
// Prompt construction — turn brief + buyers' own language into a Veo ad.
// ----------------------------------------------------------------------------
interface AdContext {
  company: string;
  input: string;
  icp: string;
  positioning: string;
  threads: { title: string; snippet: string; intentLabel: string }[];
  reelInsight: string | null;
  posterUrl: string | null;
}

function buildAdPrompt(data: AdContext, ratio: AspectRatio): string {
  const { company, icp, positioning, threads, reelInsight } = data;
  // Orientation word matching the chosen aspect, so the prompt reads naturally
  // for both the portrait (9:16) feed cut and the landscape (16:9) widescreen cut.
  const orientation = ratio === "16:9" ? "widescreen" : "vertical";

  // Surface the highest-intent buyer language first — it's the most authentic
  // hook material we have.
  const intentRank: Record<string, number> = {
    ready_to_buy: 3,
    frustrated: 2,
    comparing: 1,
    browsing: 0,
  };
  const buyerVoice = [...threads]
    .sort((a, b) => (intentRank[b.intentLabel] ?? 0) - (intentRank[a.intentLabel] ?? 0))
    .slice(0, 3)
    .map((t) => t.title.trim())
    .filter(Boolean);

  const painLine =
    buyerVoice.length > 0
      ? `Open on the real frustration buyers voice in their own words: ${buyerVoice
          .map((v) => `"${v}"`)
          .join("; ")}.`
      : `Open on the everyday frustration that ${icp || "the target buyer"} feels before discovering a fix.`;

  const positioningLine =
    positioning.trim().length > 0
      ? `Resolve the tension by revealing ${company} as the answer: ${positioning.trim()}.`
      : `Resolve the tension by revealing ${company} as the clear, modern answer.`;

  const audienceLine = icp.trim().length > 0 ? `The hero is ${icp.trim()}.` : "";

  const styleLine = reelInsight
    ? `Match the winning energy of high-performing competitor reels — ${reelInsight.trim()}`
    : "Punchy, high-contrast, modern tech-brand energy with confident motion and crisp typography.";

  return [
    `A ${AD_DURATION_SECONDS}-second ${orientation} (${ratio}) cinematic product ad for ${company}.`,
    painLine,
    audienceLine,
    positioningLine,
    `Cinematography: ${styleLine}`,
    "Bright, premium lighting; smooth camera push-ins; a single clear emotional beat from problem to relief.",
    `End on a bold, legible end-card with the name "${company}" and a confident call to action.`,
    "No watermarks, no gibberish text, no logos other than the end-card name.",
  ]
    .filter((line) => line && line.trim().length > 0)
    .join(" ");
}
