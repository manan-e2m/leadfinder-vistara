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

    async function poll() {
      try {
        const res = await fetch(`/api/run/${runId}/progress`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const json: ProgressResponse = await res.json();
        if (!alive) return;
        setData(json);
        if (json.terminal && !redirected) {
          redirected = true;
          setTimeout(() => router.replace(`/results/${runId}`), 650);
          return;
        }
      } catch {
        if (alive) setError(true);
      }
      if (alive && !redirected) setTimeout(poll, 800);
    }
    poll();
    return () => {
      alive = false;
    };
  }, [runId, router]);

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="rounded-board border border-line bg-surface p-6 shadow-board">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-ink">Building your shortlist</h1>
          {data && !data.terminal && (
            <span className="flex items-center gap-1.5 text-xs text-ink-40">
              <span className="h-2 w-2 animate-pulse-soft rounded-full bg-blue" />
              live
            </span>
          )}
        </div>

        {data?.live?.label && !data.terminal && (
          <p className="mt-1 text-sm text-blue-deep">{data.live.label}</p>
        )}
        {data?.live?.detail && <p className="text-xs text-ink-40">{data.live.detail}</p>}

        <ol className="mt-5 space-y-1">
          {(data?.stages ?? PLACEHOLDER).map((s) => (
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
          <div className="mt-5 grid grid-cols-4 gap-2 border-t border-line pt-4">
            {[
              { k: "found", v: data.counts.candidate },
              { k: "audited", v: data.counts.audited },
              { k: "held back", v: data.counts.heldBack },
              { k: "leads", v: data.counts.lead },
            ].map((c) => (
              <div key={c.k} className="text-center">
                <div className="font-mono text-lg font-bold text-ink">{c.v}</div>
                <div className="text-[10px] uppercase tracking-wide text-ink-40">{c.k}</div>
              </div>
            ))}
          </div>
        )}

        {data?.terminal && (
          <p className="mt-4 text-center text-sm text-ok">Done. Opening your shortlist…</p>
        )}
        {error && (
          <p className="mt-4 text-center text-sm text-ink-40">Reconnecting…</p>
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
