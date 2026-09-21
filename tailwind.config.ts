import type { Config } from "tailwindcss";

/**
 * E2M brand system. The three brand tokens are the only hard-coded
 * values; everything else derives from them. Swap them for the exact
 * values in the brand guide and the whole platform follows.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        blue: {
          DEFAULT: "var(--brand-primary, var(--e2m-blue))",
          deep: "var(--brand-secondary, var(--blue-deep))",
          soft: "var(--brand-soft, var(--blue-soft))",
        },
        ink: {
          DEFAULT: "var(--ink)",
          80: "var(--ink-80)",
          60: "var(--ink-60)",
          40: "var(--ink-40)",
        },
        line: { DEFAULT: "var(--line)", strong: "var(--line-strong)" },
        page: "var(--page)",
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)" },
        orange: { DEFAULT: "var(--e2m-orange)", soft: "var(--orange-soft)" },
        ok: { DEFAULT: "var(--ok)", soft: "var(--ok-soft)" },
        warn: { DEFAULT: "var(--warn)", soft: "var(--warn-soft)" },
        crit: { DEFAULT: "var(--crit)", soft: "var(--crit-soft)" },
        agency: { DEFAULT: "var(--agency)", soft: "var(--agency-soft)" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Instrument Sans", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { board: "10px", chip: "4px" },
      maxWidth: { board: "1180px" },
    },
  },
  plugins: [],
} satisfies Config;
