import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ============================================================================
// INTERCEPT — HTTP endpoints.
//
//   GET /health        liveness probe (uptime checks + the smoke test).
//   GET /chat-stream    OPTIONAL Server-Sent-Events feed of one assistant
//                       message's tokens as it streams. The PRIMARY chat channel
//                       is the reactive Convex query (api.conversations.getMessages)
//                       — the message's `content` grows live there with no extra
//                       infra. This endpoint mirrors that same data over SSE for
//                       consumers that prefer an HTTP token stream.
//
// The swarm itself runs over the Convex client API, not HTTP.
// ============================================================================

const http = httpRouter();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// GET /health -> "ok".
http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => {
    return new Response("ok", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }),
});

// CORS preflight for the SSE endpoint.
http.route({
  path: "/chat-stream",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }),
});

// GET /chat-stream?messageId=<id> -> SSE token feed for that assistant message.
// Polls the reactive message row and emits each new delta; closes when the
// message is no longer streaming (or after a hard cap so it can never hang).
http.route({
  path: "/chat-stream",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const rawId = url.searchParams.get("messageId");
    if (!rawId) {
      return new Response("missing messageId", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    const messageId = rawId as Id<"messages">;

    const encoder = new TextEncoder();
    const MAX_TICKS = 450; // ~90s at 200ms — matches the run fan-in deadline
    const POLL_MS = 200;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let lastLen = 0;
        const send = (event: string, data: unknown): void => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        };

        for (let tick = 0; tick < MAX_TICKS; tick++) {
          const msg = await ctx.runQuery(
            internal.conversations.getMessageInternal,
            { messageId },
          );
          if (!msg) {
            send("error", { error: "message not found" });
            controller.close();
            return;
          }

          if (msg.content.length > lastLen) {
            const delta = msg.content.slice(lastLen);
            lastLen = msg.content.length;
            send("delta", { delta, content: msg.content });
          }

          if (msg.isStreaming !== true) {
            send("done", { content: msg.content, runId: msg.runId ?? null });
            controller.close();
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        send("done", { content: "", timedOut: true });
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }),
});

export default http;
