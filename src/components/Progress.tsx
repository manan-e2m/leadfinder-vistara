"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

interface StageView {
  key: string;
  label: string;
  status: "pending" | "running" | "ok" | "fallback" | "failed";
  reason: string | null;
  ms: number | null;
}
interface ProgressResponse {
  status: string;
  terminal: boolean;
  live: { label: string; detail?: string } | null;
  stages: StageView[];
  counts: { candidate: number; audited: number; heldBack: number; lead: number };
  costCents: number;
  cappedAt: string | null;
  totalMs: number | null;
  fallbacks: string[];
}

const STATUS_ICON: Record<string, string> = { ok: "✓", fallback: "◑", failed: "✕", running: "•", pending: "" };

export default function Progress({ runId }: { runId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ProgressResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    let redirected = false;
    let consecErrors = 0;

    async function poll() {
      try {
        const res = await fetch(`/api/run/${runId}/progress`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const json: ProgressResponse = await res.json();
        if (!alive) return;
        setData(json);
        setError(false);
        consecErrors = 0;
        if (json.terminal && !redirected) {
          redirected = true;
          setTimeout(() => router.replace(`/results/${runId}`), 650);
          return;
        }
      } catch {
        consecErrors += 1;
        if (alive) setError(true);
      }
      if (alive && !redirected) {
        // Gentle backoff while unhealthy: 800ms -> 2s -> 4s max. Reset on success.
        const delay = Math.min(800 * 2 ** Math.max(consecErrors, 1), 4000);
        setTimeout(poll, delay);
      }
    }
    poll();
    return () => {
      alive = false;
    };
  }, [runId, router]);

  const stages = data?.stages ?? PLACEHOLDER;
  const doneCount = stages.filter((s) => s.status === "ok" || s.status === "fallback" || s.status === "failed").length;
  const runningCount = stages.filter((s) => s.status === "running").length;
  const pct = data?.terminal
    ? 100
    : Math.round(((doneCount + runningCount * 0.5) / stages.length) * 100);
  const live = data?.terminal ? "done" : "live";

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="relative overflow-hidden rounded-board border border-line bg-surface p-6 shadow-board">
        {/* Scanline sweeps the card top-to-bottom while the shortlist builds. */}
        {data && !data.terminal && (
          <div
            aria-hidden
            className="animate-scanline pointer-events-none absolute inset-x-0 top-0 h-14"
            style={{ background: "linear-gradient(180deg, rgba(22,56,251,0.12), transparent)" }}
          />
        )}
        <div className="relative flex items-center justify-between">
          <h1 className="text-lg font-bold text-ink">Building your shortlist</h1>
          {data && (
            <span
              className={clsx(
                "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em]",
                data.terminal ? "text-ok" : "text-blue"
              )}
            >
              <span
                className={clsx(
                  "h-[7px] w-[7px] animate-pulse-soft rounded-full",
                  data.terminal ? "bg-ok" : "bg-blue"
                )}
              />
              {live}
            </span>
          )}
        </div>

        {data?.live?.label && !data.terminal && (
          <p className="relative mt-1.5 text-sm font-medium text-blue-deep">{data.live.label}</p>
        )}
        {data?.terminal && (
          <p className="relative mt-1.5 text-sm font-medium text-ok">Shortlist ready. Opening your results…</p>
        )}
        {data?.live?.detail && !data.terminal && (
          <p className="relative font-mono text-xs text-ink-40">{data.live.detail}</p>
        )}

        <ol className="relative mt-5 space-y-1">
          {stages.map((s) => (
            <li
              key={s.key}
              className={clsx(
                "flex items-center gap-3 rounded-board px-3 py-2.5 text-sm",
                s.status === "running" && "bg-blue-soft",
                s.status === "pending" && "opacity-45"
              )}
            >
              <span
                className={clsx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                  s.status === "ok" && "bg-ok-soft text-ok",
                  s.status === "fallback" && "bg-warn-soft text-warn",
                  s.status === "failed" && "bg-crit-soft text-crit",
                  s.status === "running" && "bg-blue text-white",
                  s.status === "pending" && "border border-line-strong text-transparent"
                )}
              >
                {s.status === "running" ? <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-white" /> : STATUS_ICON[s.status]}
              </span>
              <span className={clsx("flex-1", s.status === "ok" ? "text-ink-80" : s.status === "running" ? "font-medium text-ink" : "text-ink-60")}>
                {s.label}
                {s.status === "fallback" && s.reason && (
                  <span className="mt-0.5 block text-[11px] text-warn">{s.reason}</span>
                )}
              </span>
              {s.ms != null && s.status !== "pending" && s.status !== "running" && (
                <span className="font-mono text-[11px] text-ink-40">{(s.ms / 1000).toFixed(1)}s</span>
              )}
            </li>
          ))}
        </ol>

        {data && (
          <>
            <div className="relative mt-5 h-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${pct}%`,
                  background: "linear-gradient(90deg, var(--e2m-blue), var(--e2m-orange))",
                }}
              />
            </div>
            <div className="relative mt-2 flex justify-between font-mono text-[11px] text-ink-40">
              <span>{data.totalMs != null ? `${(data.totalMs / 1000).toFixed(1)}s elapsed` : `${pct}% complete`}</span>
            </div>
          </>
        )}

        {data && (
          <div className="relative mt-5 grid grid-cols-4 gap-2 border-t border-line pt-4">
            {[
              { k: "found", v: data.counts.candidate, cls: "text-ink" },
              { k: "audited", v: data.counts.audited, cls: "text-ink" },
              { k: "held back", v: data.counts.heldBack, cls: data.counts.heldBack > 0 ? "text-warn" : "text-ink" },
              { k: "leads", v: data.counts.lead, cls: data.terminal ? "text-ok" : "text-blue" },
            ].map((c) => (
              <div key={c.k} className="text-center">
                <div className={clsx("font-mono text-2xl font-bold tabular-nums tracking-tight transition-colors", c.cls)}>{c.v}</div>
                <div className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-40">{c.k}</div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className="relative mt-4 text-center text-sm text-ink-40">Reconnecting…</p>
        )}
      </div>
    </div>
  );
}

const PLACEHOLDER: StageView[] = [
  "Reading your footprint across 6 sources",
  "Choosing the sourcing route",
  "Finding businesses that match your ICP",
  "Auditing sites, reviews and ad activity",
  "Verifying phone, email and business status",
  "Scoring and ranking against your ICP",
  "Drafting openers and building branded audits",
].map((label, i) => ({ key: String(i), label, status: i === 0 ? "running" : "pending", reason: null, ms: null }));
