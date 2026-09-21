"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { normalizeDomain } from "@/lib/domain";
import { CONFIDENCE_THRESHOLD, type Icp } from "@/lib/types";
import { useBrand, BrandLogo } from "./BrandProvider";
import { Chip } from "./ui";

/** Booth-demo fixture agency; seeded by prisma/seed.ts and served from mock. */
const DEMO_DOMAIN = "harborandoak.com";

interface ScanResponse {
  workspaceId: string;
  runId: string;
  domain: string;
  corrected: boolean;
  icp: Icp;
  brand: { agencyName: string };
  sourcesUsed: string[];
  fellBackToQuestions: boolean;
  siteFailure: string | null;
  needsConfirmation: string[];
}

const FIELD_ORDER = ["servicesOffered", "targetVerticals", "geography", "dealSizeTier"] as const;
const FIELD_LABEL: Record<string, string> = {
  servicesOffered: "Services you offer",
  targetVerticals: "Who you target",
  geography: "Where you work",
  dealSizeTier: "Typical deal size",
};

export default function ScanFlow() {
  const router = useRouter();
  const { brand } = useBrand();
  const [phase, setPhase] = useState<"input" | "confirm">("input");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [icp, setIcp] = useState<Icp | null>(null);
  /** the registrable domain actually being scanned, shown under the input */
  const [scanned, setScanned] = useState<string | null>(null);

  async function runScan(raw?: string) {
    const value = raw ?? input;
    // Paste cleanup before the request: 'https://www.acme.com/about' →
    // acme.com. The same normalize runs server-side; doing it here too lets
    // us show exactly what will be scanned and reject nonsense instantly.
    const norm = normalizeDomain(value);
    if (!norm.ok) {
      setError(
        "That doesn't look like a website. Try the bare domain, e.g. acmeagency.com — pasting a full URL is fine, we'll strip the rest."
      );
      return;
    }
    setScanned(norm.domain);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: norm.domain }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "not_a_domain"
            ? "That doesn't look like a website. Try the bare domain, e.g. acmeagency.com."
            : (data.message ?? "Something went wrong. Try again.")
        );
        return;
      }
      setScan(data);
      setIcp(data.icp);
      setPhase("confirm");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function setField(key: (typeof FIELD_ORDER)[number], value: string) {
    if (!icp) return;
    setIcp({
      ...icp,
      [key]: { ...icp[key], value, confirmed: true, confidence: Math.max(icp[key].confidence, 0.95) },
    });
  }

  /** "Who you target" takes multiple verticals — comma-joined into .value,
   * which the route matcher and sourcing-widening both already expect
   * (route regexes test substrings; Place search splits on [,&]). */
  function toggleVertical(opt: string) {
    if (!icp) return;
    const f = icp.targetVerticals;
    const current = f.value.split(",").map((s) => s.trim()).filter(Boolean);
    const next = current.includes(opt)
      ? current.filter((v) => v !== opt)
      : [...current, opt];
    const value = next.join(", ");
    setIcp({
      ...icp,
      targetVerticals: {
        ...f,
        value,
        confirmed: next.length > 0,
        // A deliberate multi-pick reads as more signal, not less.
        confidence: next.length > 0 ? Math.max(f.confidence, 0.9) : f.confidence,
      },
    });
  }

  async function confirm() {
    if (!scan || !icp) return;
    setLoading(true);
    // Mark every field confirmed; the pipeline trusts the confirmed card.
    const confirmedIcp: Icp = { ...icp };
    for (const k of FIELD_ORDER) confirmedIcp[k] = { ...confirmedIcp[k], confirmed: true };
    try {
      const res = await fetch(`/api/run/${scan.runId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icp: confirmedIcp }),
      });
      if (!res.ok) {
        setError("Couldn't start the run. Try again.");
        setLoading(false);
        return;
      }
      router.push(`/run/${scan.runId}`);
    } catch {
      setError("Network error starting the run.");
      setLoading(false);
    }
  }

  if (phase === "input" || !scan || !icp) {
    const liveNorm = normalizeDomain(input);
    const cleaned = liveNorm.ok && liveNorm.domain !== input.trim().toLowerCase() ? liveNorm.domain : null;
    return (
      <div className="mx-auto w-full max-w-xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runScan();
          }}
          className="animate-rise rounded-board border border-line bg-surface p-6 shadow-board"
        >
          <h1 className="text-2xl font-bold tracking-tight text-ink">Find your next 20 clients</h1>
          <p className="mt-2 text-sm text-ink-60">
            Enter your agency&apos;s website. We read your footprint across six sources, then find verified,
            scored, ready-to-contact prospects that match. Takes about a minute.
          </p>
          <div className="mt-5 flex gap-2">
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="youragency.com"
              className="min-w-0 flex-1 rounded-board border border-line-strong bg-page px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-40 focus:border-blue"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="press rounded-board bg-blue px-5 py-3 text-sm font-semibold text-white shadow-lift transition hover:bg-blue-deep disabled:opacity-50 disabled:shadow-none"
            >
              {loading ? "Reading…" : "Scan"}
            </button>
          </div>
          {cleaned && (
            <p className="mt-2 text-xs text-ink-60">
              We&apos;ll scan <span className="font-mono font-semibold text-ink">{cleaned}</span> — the rest of
              what you pasted is stripped.
            </p>
          )}
          {scanned && error && !loading && (
            <p className="mt-2 text-[11px] text-ink-40">Last attempt scanned {scanned}.</p>
          )}
          {error && <p className="mt-3 text-sm text-crit">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setInput(DEMO_DOMAIN);
                void runScan(DEMO_DOMAIN);
              }}
              disabled={loading}
              className="rounded-board border border-line-strong bg-page px-3 py-1.5 text-xs font-semibold text-ink-60 hover:border-blue hover:text-ink disabled:opacity-50"
            >
              Try a demo agency → harborandoak.com
            </button>
            <span className="text-xs text-ink-40">Runs the seeded fixture in mock mode — about 60s.</span>
          </div>
          <p className="mt-4 text-xs text-ink-40">
            No signup to see results. We draft outreach. You decide what to send.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="animate-rise rounded-board border border-line bg-surface p-6 shadow-board">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo size={36} />
            <div>
              <h2 className="text-lg font-bold text-ink">{scan.brand.agencyName}</h2>
              <p className="text-xs text-ink-40">{scan.domain}</p>
            </div>
          </div>
          <Chip tone="blue">{scan.sourcesUsed.length} sources read</Chip>
        </div>

        {brand.generated && (
          <p className="mt-2 text-[10px] font-medium uppercase tracking-wide text-ink-40">
            Using a generated brand. We couldn&apos;t read your logo or colours from your site.
          </p>
        )}

        {scan.corrected && (
          <p className="mt-2 text-xs text-ink-40">Assuming you meant {scan.domain}.</p>
        )}
        {scan.siteFailure && (
          <div className="mt-2 rounded-board border border-warn/30 bg-warn-soft px-3 py-2">
            <p className="text-xs font-semibold text-warn">
              We couldn&apos;t read that website — check spelling or try the bare domain.
            </p>
            <p className="mt-0.5 text-[11px] text-warn">
              We filled this card in from your other listings. Confirm below, or re-scan to retry.
            </p>
            <button
              type="button"
              onClick={() => {
                setPhase("input");
                void runScan(scan.domain);
              }}
              disabled={loading}
              className="mt-2 rounded-board border border-warn bg-surface px-3 py-1.5 text-[11px] font-semibold text-warn hover:bg-warn-soft/60 disabled:opacity-50"
            >
              Retry scan of {scan.domain}
            </button>
          </div>
        )}

        <p className="mt-4 text-sm text-ink-60">
          Here&apos;s what we inferred about who you sell to. Tap to confirm or correct; this picks your
          sourcing route.
        </p>

        <div className="mt-4 space-y-4">
          {FIELD_ORDER.map((key, i) => {
            const f = icp[key];
            const weak = !f.confirmed && (f.confidence < CONFIDENCE_THRESHOLD || !f.value);
            return (
              <div key={key} className="animate-stagger rounded-board border border-line bg-page p-4" style={{ ["--i" as string]: i }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-40">
                    {FIELD_LABEL[key]}
                  </span>
                  {f.confirmed ? (
                    <Chip tone="ok">Confirmed</Chip>
                  ) : weak ? (
                    <Chip tone="warn">Needs a tap</Chip>
                  ) : (
                    <Chip tone="blue">{Math.round(f.confidence * 100)}% sure</Chip>
                  )}
                </div>

                {f.value && !weak ? (
                  <p className="mt-1.5 text-[15px] font-medium text-ink">{f.value}</p>
                ) : (
                  <p className="mt-1.5 text-sm text-ink-60">We&apos;re not sure. Pick the closest:</p>
                )}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {f.options.map((opt) => {
                    const isMulti = key === "targetVerticals";
                    const selected = isMulti
                      ? f.value.split(",").map((s) => s.trim()).includes(opt) && f.value !== ""
                      : f.value === opt;
                    return (
                      <button
                        key={opt}
                        onClick={() => (isMulti ? toggleVertical(opt) : setField(key, opt))}
                        className={clsx(
                          "rounded-chip border px-2.5 py-1 text-xs font-medium transition",
                          selected
                            ? "border-blue bg-blue-soft text-blue-deep"
                            : "border-line-strong bg-surface text-ink-60 hover:border-blue"
                        )}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {f.sources.length > 0 && (
                  <p className="mt-2 text-[11px] text-ink-40">from {f.sources.join(", ")}</p>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-3 text-sm text-crit">{error}</p>}

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={confirm}
            disabled={loading}
            className="press flex-1 rounded-board bg-blue px-5 py-3 text-sm font-semibold text-white shadow-lift transition hover:bg-blue-deep disabled:opacity-50"
          >
            {loading ? "Starting…" : "Looks right. Find my prospects"}
          </button>
          <button
            onClick={() => setPhase("input")}
            className="rounded-board px-3 py-3 text-sm text-ink-60 hover:text-ink"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
