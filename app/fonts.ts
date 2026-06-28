import { Inter, JetBrains_Mono } from "next/font/google";

// figmaSans substitute. No `weight` field → loads the VARIABLE font (full wght axis),
// so DESIGN's 320/330/340/480/540/700 all interpolate from one file.
export const figmaSans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figma-sans",
});

// figmaMono substitute — eyebrows + captions ONLY (never body copy).
export const figmaMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figma-mono",
});
