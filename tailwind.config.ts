import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a0a0b",
        panel: "#141417",
        line: "#26262b",
        accent: "#ff6a2b", // orange-slice
        good: "#34d399",
      },
    },
  },
  plugins: [],
} satisfies Config;
