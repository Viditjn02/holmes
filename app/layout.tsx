import type { Metadata, Viewport } from "next";
import "./globals.css";
import { figmaSans, figmaMono } from "./fonts";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import PostHogProvider from "@/components/PostHogProvider";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "INTERCEPT — the AI-native GTM chat",
  description:
    "One chat. Paste anything — a company, a competitor, an idea. A router decides what to do and does it: finds the live threads where your buyers are asking, sources decision-makers with verified emails, drafts and sends signal-grounded outreach, scouts competitor ads, and makes the creative — live, on a canvas beside you.",
};

export const viewport: Viewport = {
  // Browser chrome matches the canvas per scheme: white (light) · neutral
  // charcoal #0B0C0E (dark — the retuned Linear/Attio-grade night ground).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0B0C0E" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${figmaSans.variable} ${figmaMono.variable}`}
      suppressHydrationWarning // theme class is set pre-paint by the script below
    >
      <head>
        {/* Benign-rejection guard — FIRST thing in <head> so its listeners are
            registered at HTML-parse time, BEFORE any Next.js / React-refresh dev
            chunk attaches its own error-overlay handlers. Capture-phase + first
            registration means we run before the overlay, and
            stopImmediatePropagation prevents it from ever seeing a benign event.

            What this swallows (and ONLY this): expected network cancellations —
            TimeoutError / AbortError / "Load failed" / "Failed to fetch" and the
            same transport noise Convex's local backend emits every time
            `convex dev` hot-reloads and drops its in-flight WebSocket requests.
            These are harmless (the client reconnects) but would otherwise pop
            Next's full-screen dev overlay and block the UI.

            What this DELIBERATELY lets through: every real bug — TypeErrors,
            thrown render errors, missing-Convex-function errors, etc. We never
            blanket-hide; if a genuine error reaches here it still surfaces so it
            can be fixed at the source. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  function isBenign(reason) {
                    if (!reason) return false;
                    var name = "";
                    try {
                      name = String(
                        reason.name ||
                          (reason.constructor && reason.constructor.name) ||
                          ""
                      ).toLowerCase();
                    } catch (e) {}
                    if (name === "timeouterror" || name === "aborterror") return true;
                    var msg = "";
                    try {
                      msg = String(reason.message != null ? reason.message : reason);
                    } catch (e) {
                      msg = "";
                    }
                    msg = msg.toLowerCase();
                    return (
                      msg.indexOf("timeouterror") !== -1 ||
                      msg.indexOf("aborterror") !== -1 ||
                      msg.indexOf("operation timed out") !== -1 ||
                      msg.indexOf("operation was aborted") !== -1 ||
                      msg.indexOf("the user aborted a request") !== -1 ||
                      msg.indexOf("load failed") !== -1 ||
                      msg.indexOf("failed to fetch") !== -1 ||
                      msg.indexOf("network request failed") !== -1 ||
                      msg.indexOf("networkerror when attempting to fetch") !== -1
                    );
                  }
                  function swallow(e) {
                    try {
                      if (e && typeof e.preventDefault === "function") e.preventDefault();
                      if (e && typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
                      if (e && typeof e.stopPropagation === "function") e.stopPropagation();
                    } catch (err) {}
                  }
                  window.addEventListener(
                    "unhandledrejection",
                    function (e) {
                      if (isBenign(e && e.reason)) swallow(e);
                    },
                    true
                  );
                  window.addEventListener(
                    "error",
                    function (e) {
                      var reason = e && (e.error != null ? e.error : e.message);
                      if (isBenign(reason)) swallow(e);
                    },
                    true
                  );
                } catch (e) {}
              })();
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var t = localStorage.getItem('intercept-theme') || 'light';
                  var root = document.documentElement;
                  root.setAttribute('data-theme', t);
                  root.classList.toggle('dark', t === 'dark');
                  root.style.colorScheme = t === 'dark' ? 'dark' : 'light';
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <ConvexClientProvider>
            <PostHogProvider>{children}</PostHogProvider>
          </ConvexClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
