"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Chip } from "./ui";

interface OpsData {
  mode: string;
  costCapCents: number;
  queue: { waiting: number; active: number; capacity: number };
  providers: { slot: string; name: string; live: boolean }[];
  cache: Record<string, { entries: number; hits: number }>;
  runsSnapshot?: { staleNonTerminal: number; staleAfterMs: number };
  recentFailures: { stage: string; reason: string; url: string | null; at: string }[];
  recentRuns: { id: string; agency: string; status: string; mode: string; leads: number; costCents: number; totalMs: number | null; startedAt: string }[];
}

export default function OpsBoard({ token = "" }: { token?: string }) {
  const [data, setData] = useState<OpsData | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/providers", {
          cache: "no-store",
          headers: token ? { "x-ops-token": token } : undefined,
        });
        if (alive && res.ok) setData(await res.json());
      } catch {
        /* keep last good */
      }
      if (alive) setTimeout(poll, 3000);
    }
    poll();
    return () => {
      alive = false;
    };
  }, [token]);

  if (!data) return <p className="text-sm text-ink-40">Loading ops…</p>;

  const liveCount = data.providers.filter((p) => p.live).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Ops</h2>
        <span className="flex items-center gap-2 font-mono text-[11px] text-ink-40">
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-ok" />
          polling every 3s
        </span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Mode" value={data.mode} i={0} />
        <Stat label="Live providers" value={`${liveCount}/${data.providers.length}`} i={1} />
        <Stat label="Queue" value={`${data.queue.active} active · ${data.queue.waiting} waiting`} tone="blue" i={2} />
        <Stat label="Cost cap" value={`${data.costCapCents}¢ / run`} i={3} />
        {data.runsSnapshot && (
          <Stat
            label="Stale runs"
            value={data.runsSnapshot.staleNonTerminal > 0
              ? `${data.runsSnapshot.staleNonTerminal} need recovery`
              : "0"}
            tone={data.runsSnapshot.staleNonTerminal > 0 ? "warn" : "ok"}
            i={4}
          />
        )}
      </div>

      <Panel title="Providers">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {data.providers.map((p) => (
            <div key={p.slot} className="flex items-center justify-between rounded-board border border-line bg-surface px-3 py-2">
              <div>
                <p className="text-sm font-medium text-ink">{p.slot}</p>
                <p className="font-mono text-[11px] text-ink-40">{p.name}</p>
              </div>
              {p.live ? <Chip tone="ok">live</Chip> : <Chip>mock</Chip>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Recent runs">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink-40">
                <th className="pb-2 pr-3 font-medium">Agency</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 pr-3 font-medium">Leads</th>
                <th className="pb-2 pr-3 font-medium">Cost</th>
                <th className="pb-2 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {data.recentRuns.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <a href={`/results/${r.id}`} className="font-medium text-blue hover:text-blue-deep">{r.agency}</a>
                    <span className="ml-1.5 text-[10px] text-ink-40">{r.mode}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={clsx(
                      "font-medium",
                      r.status === "complete" && "text-ok",
                      r.status === "degraded" && "text-warn",
                      r.status === "failed" && "text-crit",
                      r.status === "running" && "text-blue",
                    )}>{r.status}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-ink-80">{r.leads}</td>
                  <td className="py-2 pr-3 font-mono text-ink-80">{r.costCents.toFixed(1)}¢</td>
                  <td className="py-2 font-mono text-ink-40">{r.totalMs ? `${(r.totalMs / 1000).toFixed(1)}s` : "—"}</td>
                </tr>
              ))}
              {data.recentRuns.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-ink-40">No runs yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Cache">
          {Object.keys(data.cache).length === 0 ? (
            <p className="text-sm text-ink-40">Cold. No pools warmed yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {Object.entries(data.cache).map(([kind, s]) => (
                <li key={kind} className="flex items-center justify-between text-sm">
                  <span className="text-ink-80">{kind}</span>
                  <span className="font-mono text-ink-40">{s.entries} entries · {s.hits} hits</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent failures">
          {data.recentFailures.length === 0 ? (
            <p className="text-sm text-ink-40">Clean. Nothing logged.</p>
          ) : (
            <ul className="space-y-2">
              {data.recentFailures.map((f, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2.5 rounded-board border border-crit-soft bg-crit-soft px-3 py-2"
                >
                  <span className="shrink-0 rounded-chip bg-crit-soft px-2 py-0.5 text-[10px] font-bold text-crit">
                    {f.stage}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-80">{f.reason}</span>
                  {f.url && <span className="shrink-0 font-mono text-[10.5px] text-ink-40">{f.url}</span>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "ink",
  i = 0,
}: {
  label: string;
  value: string;
  tone?: "ink" | "blue" | "ok" | "warn";
  i?: number;
}) {
  const toneCls = { ink: "text-ink", blue: "text-blue", ok: "text-ok", warn: "text-warn" }[tone];
  return (
    <div className="animate-stagger rounded-board border border-line bg-surface px-4 py-3" style={{ ["--i" as string]: i }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-40">{label}</p>
      <p className={clsx("mt-1.5 font-mono text-lg font-bold tracking-tight", toneCls)}>{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-40">{title}</h2>
      <div className="rounded-board border border-line bg-surface p-4">{children}</div>
    </section>
  );
}
