import type { Metadata, Viewport } from "next";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import PostHogProvider from "@/components/PostHogProvider";

export const metadata: Metadata = {
  title: "INTERCEPT — the AI-native GTM chat",
  description:
    "One chat. Paste anything — a company, a competitor, an idea. A router decides what to do and does it: finds the live threads where your buyers are asking, sources decision-makers with verified emails, drafts and sends signal-grounded outreach, scouts competitor ads, and makes the creative — live, on a canvas beside you.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
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
    <html lang="en">
      <body>
        <ConvexClientProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </ConvexClientProvider>
      </body>
    </html>
  );
}
