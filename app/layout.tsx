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
