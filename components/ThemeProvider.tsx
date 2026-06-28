"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// ============================================================================
// ThemeProvider — minimal light/night theme. Persists to localStorage, DEFAULTS
// TO LIGHT (the Figma editorial theme). Sets `.dark` on <html> for Tailwind's
// `dark:` variants AND `data-theme="dark"` for the raw CSS-var block in
// globals.css. No next-themes, no other deps. A pre-paint inline script in
// layout.tsx applies the saved theme before hydration (no flash).
// ============================================================================

type Theme = "light" | "dark";
const STORAGE_KEY = "intercept-theme";

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(t: Theme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", t);
  root.classList.toggle("dark", t === "dark");
  root.style.colorScheme = t === "dark" ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default LIGHT. The pre-paint script already applied the saved value; we read
  // it back on mount to sync React state (no flash, no mismatch).
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const saved =
      (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "light";
    setThemeState(saved);
    applyTheme(saved);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore quota / private-mode errors */
    }
  }, []);

  const toggle = useCallback(
    () => setTheme(theme === "dark" ? "light" : "dark"),
    [theme, setTheme],
  );

  return (
    <ThemeContext.Provider value={{ theme, toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
