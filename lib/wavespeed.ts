// ============================================================================
// INTERCEPT — WAVESPEED LTX-2.3 IMAGE-TO-VIDEO CLIENT  (deploy-safe, $cheap)
// ----------------------------------------------------------------------------
// The FIRST link in the Creative agent's provider chain (convex/agents/creative.ts).
// WaveSpeed hosts the open-source LTX-2.3 model behind a plain HTTPS REST API, so
// — unlike the localhost Ken-Burns worker — it works from a DEPLOYED Convex action.
// It animates the already-generated gpt-image-1 ad poster (image-to-video) into a
// short cinematic clip.
//
// Pure `fetch` only (no SDK, no node:* imports) → safe in the DEFAULT Convex
// runtime (this is imported by the non-"use node" creative agent).
//
// NEVER throws: every failure (missing key, bad poster, HTTP error, poll timeout,
// provider "failed") returns `null` so the chain falls through to Veo / fal / the
// local worker and the run is never blocked.
//
// API shape (WaveSpeed v3 async predictions):
//   POST https://api.wavespeed.ai/api/v3/wavespeed-ai/ltx-2.3/image-to-video
//        Authorization: Bearer $WAVESPEED_API_KEY
//        { image, prompt, resolution, duration, aspect_ratio }
//     -> { data: { id, status, urls: { get } } }            (status "created")
//   GET  data.urls.get  (poll)  -> { data: { status, outputs } }
//     status flips created -> processing -> completed | failed
//     on "completed" the mp4 URL is data.outputs[0] (string, or { url })
// ============================================================================

import type { AdAspect, AspectRatio } from "./contract";

const WAVESPEED_ENDPOINT =
  "https://api.wavespeed.ai/api/v3/wavespeed-ai/ltx-2.3/image-to-video";
// Fallback poll URL when the submit response omits data.urls.get.
const WAVESPEED_RESULT_BASE = "https://api.wavespeed.ai/api/v3/predictions";

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 60; // ~3 min ceiling
const DEFAULT_RESOLUTION = "720p"; // "480p" | "720p" | "1080p"
const DEFAULT_DURATION_SECONDS = 5;

// Object-form input shared with the Creative agent.
export interface WavespeedVideoInput {
  /** Source image the model animates (the gpt-image-1 ad poster). Required. */
  imageUrl: string;
  /** The cinematic ad prompt. Required, non-empty. */
  prompt: string;
  /** Orientation — accepts the AdAspect option OR a raw aspect-ratio string. */
  aspect: AdAspect | AspectRatio | string;
  /** Output resolution, e.g. "720p". Defaults to "720p". */
  resolution?: string;
  /** Target duration in seconds. Defaults to 5. */
  duration?: number;
}

/** Returns the WaveSpeed key, or undefined if it isn't configured. */
function getApiKey(): string | undefined {
  return process.env.WAVESPEED_API_KEY ?? undefined;
}

/** Map any orientation hint → the WaveSpeed aspect-ratio string (9:16 / 16:9). */
function toRatio(aspect: AdAspect | AspectRatio | string | undefined): AspectRatio {
  return aspect === "16:9" || aspect === "landscape" ? "16:9" : "9:16";
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generate a short video by animating a single image with WaveSpeed LTX-2.3.
 *
 * Returns a directly-fetchable mp4 URL, or `null` on ANY failure (missing
 * WAVESPEED_API_KEY, missing image/prompt, HTTP error, provider failure, or
 * poll timeout). Never throws — the caller falls through to the next provider.
 */
export async function generateVideoFromImage(
  input: WavespeedVideoInput,
): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    // No WAVESPEED_API_KEY — skip silently; the chain falls through to Veo/fal.
    return null;
  }

  const imageUrl = input.imageUrl?.trim();
  const prompt = input.prompt?.trim();
  if (!imageUrl || !prompt) {
    // image-to-video needs both a source image and a prompt.
    return null;
  }

  const auth = { Authorization: `Bearer ${apiKey}` };

  try {
    // 1) Submit the image-to-video task.
    const submitRes = await fetch(WAVESPEED_ENDPOINT, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        image: imageUrl,
        prompt,
        resolution: input.resolution ?? DEFAULT_RESOLUTION,
        duration: input.duration ?? DEFAULT_DURATION_SECONDS,
        aspect_ratio: toRatio(input.aspect),
      }),
    });

    if (!submitRes.ok) {
      console.error(
        `[wavespeed] submit failed: ${submitRes.status} ${submitRes.statusText}`,
      );
      return null;
    }

    const submit = (await submitRes.json()) as Record<string, unknown>;
    const data = (submit.data as Record<string, unknown> | undefined) ?? submit;
    const id = typeof data.id === "string" ? data.id : undefined;
    const pollUrl = resolvePollUrl(data, id);
    if (!pollUrl) {
      return null;
    }

    // 2) Poll until the task completes (or the budget is exhausted).
    let attempts = 0;
    while (attempts < MAX_POLL_ATTEMPTS) {
      await delay(POLL_INTERVAL_MS);
      attempts += 1;

      const pollRes = await fetch(pollUrl, { headers: auth });
      if (!pollRes.ok) {
        continue; // transient — keep polling within budget
      }

      const body = (await pollRes.json()) as Record<string, unknown>;
      const result = (body.data as Record<string, unknown> | undefined) ?? body;
      const status = String(result.status ?? "").toLowerCase();

      if (status === "completed" || status === "succeeded") {
        return extractVideoUrl(result);
      }
      if (status === "failed" || status === "error" || status === "canceled") {
        console.error("[wavespeed] render failed:", result.error ?? status);
        return null;
      }
      // "created" | "processing" | "queued" — keep polling.
    }

    // Timed out — let the caller fall through to the next provider.
    return null;
  } catch (err) {
    console.error("[wavespeed] render error:", err);
    return null;
  }
}

/** Resolve the poll URL from data.urls.get, else construct the v3 result URL. */
function resolvePollUrl(
  data: Record<string, unknown>,
  id: string | undefined,
): string | undefined {
  const urls = data.urls as { get?: string } | undefined;
  if (typeof urls?.get === "string" && urls.get) {
    return urls.get;
  }
  return id ? `${WAVESPEED_RESULT_BASE}/${id}/result` : undefined;
}

/**
 * Pull the mp4 URL out of a completed WaveSpeed result. v3 returns `outputs` as
 * an array of plain string URLs, but some schemas wrap each as { url } — and a
 * few expose `output`/`video.url`, so we defensively probe the common shapes.
 */
function extractVideoUrl(result: Record<string, unknown>): string | null {
  const outputs = result.outputs;
  if (Array.isArray(outputs) && outputs.length > 0) {
    const first = outputs[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && typeof (first as { url?: string }).url === "string") {
      return (first as { url: string }).url;
    }
  }
  if (typeof result.output === "string") return result.output;
  const video = result.video as { url?: string } | undefined;
  if (typeof video?.url === "string") return video.url;
  return null;
}
