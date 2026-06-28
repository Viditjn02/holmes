"use client";

import { useTheme } from "./ThemeProvider";

// ============================================================================
// ThemeToggle — circular icon button per DESIGN `button-icon-circular`:
// rounded-full, 40px, surface-soft ground, ink glyph. Sun (light) ⇄ Moon
// (night). Monochrome — no accent.
// ============================================================================
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to night theme"}
      title={isDark ? "Light" : "Night"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-soft text-ink transition-transform hover:scale-105"
    >
      {isDark ? (
        // moon
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <path
            d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // sun
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
          <path
            d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
