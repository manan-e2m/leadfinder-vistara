import clsx from "clsx";
import { SCORE_WEIGHTS } from "@/lib/types";

/** Shared, presentational primitives. No hooks — safe in server components. */

export const SEVERITY: Record<string, { label: string; cls: string; dot: string }> = {
  high: { label: "High", cls: "text-crit bg-crit-soft", dot: "bg-crit" },
  med: { label: "Medium", cls: "text-warn bg-warn-soft", dot: "bg-warn" },
  low: { label: "Low", cls: "text-ink-60 bg-surface-2", dot: "bg-ink-40" },
};

export const FAMILY_LABEL: Record<string, string> = {
  web: "Web", ecommerce: "eCommerce", seo: "SEO", ppc: "PPC", content: "Content", ai: "AI intake",
};

/**
 * App-chrome logo mark. Server-component-safe: it reads the centralized
 * brand through the CSS variables that layout.tsx injects on <body>
 * (--logo-url / --brand-primary), so the extracted logo + colors apply
 * across the whole platform, not just the audit page. When nothing was
 * extracted (--logo-url: none) it falls back to a generated letter mark —
 * the "Using generated brand" hint is rendered by the client-side
 * <BrandLogo> (see components/BrandProvider.tsx) where the context lives.
 */
export function Wordmark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="group flex items-center gap-2.5">
      <span
        className="brand-mark relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px] text-[15px] font-extrabold leading-none tracking-tight text-white shadow-lift"
      >
        <span className="brand-mark-logo" aria-hidden />
        <span className="e2m-letter relative z-10">
          E<span className="text-white/95">2</span>M
        </span>
        {/* animated sheen sweeps across on hover */}
        <span className="e2m-mark-sheen" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[16px] font-extrabold tracking-tight text-ink">
          Lead<span className="text-blue">Finder</span>
        </span>
        {subtitle && (
          <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-ink-40">
            {subtitle}
          </span>
        )}
      </span>
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "blue" | "ok" | "warn" | "crit";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-ink-60",
    blue: "bg-blue-soft text-blue-deep",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    crit: "bg-crit-soft text-crit",
  };
  return (
    <span className={clsx("inline-flex items-center rounded-chip px-2 py-0.5 text-[11px] font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

const COMPONENT_META = [
  { key: "fit", label: "Fit", max: SCORE_WEIGHTS.fit, color: "var(--e2m-blue)" },
  { key: "pain", label: "Pain", max: SCORE_WEIGHTS.pain, color: "var(--crit)" },
  { key: "pay", label: "Ability to pay", max: SCORE_WEIGHTS.pay, color: "var(--ok)" },
  { key: "reach", label: "Reachability", max: SCORE_WEIGHTS.reach, color: "var(--warn)" },
] as const;

/** Showing the arithmetic is what makes a skeptical room trust the number. */
export function ScoreBreakdown({
  breakdown,
  compact = false,
}: {
  breakdown: { fit: number; pain: number; pay: number; reach: number };
  compact?: boolean;
}) {
  return (
    <div className={clsx("grid gap-x-4 gap-y-2", compact ? "grid-cols-2" : "grid-cols-4")}>
      {COMPONENT_META.map((c, i) => {
        const value = breakdown[c.key];
        const pct = Math.round((value / c.max) * 100);
        return (
          <div key={c.key}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-[11px] font-medium text-ink-60">{c.label}</span>
              <span className="font-mono text-[11px] text-ink-80">
                {value}<span className="text-ink-40">/{c.max}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="animate-bar h-full rounded-full"
                style={{ ["--w" as string]: `${pct}%`, ["--i" as string]: i, background: c.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ScorePill({ score }: { score: number }) {
  const tone = score >= 75 ? "text-ok" : score >= 55 ? "text-blue-deep" : "text-ink-80";
  return (
    <div className="animate-pop flex flex-col items-center">
      <span className={clsx("font-mono text-2xl font-bold leading-none", tone)}>{score}</span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-40">score</span>
    </div>
  );
}

/**
 * Circular score ring. The arc animates from empty to score on mount, colored
 * by band — the number lives in the middle. The full circle is 113 (2πr,
 * r=18); the exposed arc is score% of it. `index` staggers the sweep down a
 * ranked list.
 */
export function ScoreRing({ score, index = 0 }: { score: number; index?: number }) {
  const color = score >= 80 ? "var(--ok)" : score >= 70 ? "var(--blue-deep)" : "var(--ink-80)";
  const dash = (113 - (score / 100) * 113).toFixed(1);
  return (
    <span className="relative block h-[46px] w-[46px] shrink-0">
      <svg viewBox="0 0 44 44" className="h-[46px] w-[46px] -rotate-90">
        <circle cx="22" cy="22" r="18" fill="none" stroke="var(--line)" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r="18"
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="113"
          className="animate-ring"
          style={{ ["--dash" as string]: dash, ["--i" as string]: index }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-mono text-sm font-bold tabular-nums"
        style={{ color }}
      >
        {score}
      </span>
    </span>
  );
}
