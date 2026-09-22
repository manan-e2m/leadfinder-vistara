"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeDomain } from "@/lib/domain";
import { CONFIDENCE_THRESHOLD, type BrandAssets, type Icp } from "@/lib/types";
import { DEFAULT_BRAND } from "@/lib/brandTheme";
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
  brand: BrandAssets;
  sourcesUsed: string[];
  fellBackToQuestions: boolean;
  siteFailure: string | null;
  needsConfirmation: string[];
}

/** Rotating footprint sources shown while a scan is in flight. */
const READING_STEPS = ["sitemap", "Google Business Profile", "ad library", "tech stack"];

const FIELD_ORDER = ["servicesOffered", "targetVerticals", "geography", "dealSizeTier"] as const;
const FIELD_LABEL: Record<string, string> = {
  servicesOffered: "Services you offer",
  targetVerticals: "Who you target",
  geography: "Where you work",
  dealSizeTier: "Typical deal size",
};

export default function ScanFlow() {
  const router = useRouter();
  const { setBrand } = useBrand();
  const [phase, setPhase] = useState<"input" | "confirm">("input");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [icp, setIcp] = useState<Icp | null>(null);
  /** the registrable domain actually being scanned, shown under the input */
  const [scanned, setScanned] = useState<string | null>(null);
  /** cycles the "reading…" source label while a scan is in flight */
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setStepIdx((i) => i + 1), 420);
    return () => clearInterval(t);
  }, [loading]);

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
      if (data.brand?.logoUrl && !data.brand.generated) {
        setBrand({ ...DEFAULT_BRAND, ...data.brand });
      } else {
        setBrand(DEFAULT_BRAND);
      }
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

  /** Every confirm-card field takes multiple picks, comma-joined into
   * .value. Route matching tests substrings; Place search and B2B region
   * lists split on commas, so "Anywhere in the U.S., Canada" and
   * "$5k–$10k/mo, $10k+/mo" both flow through as-is. */
  const MULTI_FIELDS = new Set<string>(FIELD_ORDER);

  /* ── custom capsules and user-added fields ────────────────────
   * Every card gets a "+ Add" capsule: type any term, it becomes a chip on
   * that card and joins the same comma contract. "＋ Add your own" appends
   * a brand-new labeled card — label + free-text value — carried through
   * to the run as icp.custom so the pipeline and outreach copy can
   * reference it. */
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<{ label: string; value: string }[]>([]);
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [addFieldLabel, setAddFieldLabel] = useState("");
  const [addFieldValue, setAddFieldValue] = useState("");

  function setDraft(key: string, text: string) {
    setCustomDraft((d) => ({ ...d, [key]: text }));
  }

  function commitCustom(key: (typeof FIELD_ORDER)[number], isMulti: boolean) {
    const text = (customDraft[key] ?? "").trim();
    if (!text || !icp) return;
    if (isMulti) {
      const f = icp[key];
      const current = f.value.split(",").map((s) => s.trim()).filter(Boolean);
      const next = [...current, text];
      setIcp({
        ...icp,
        [key]: { ...f, value: next.join(", "), confirmed: true, confidence: Math.max(f.confidence, 0.9) },
      });
    } else {
      setField(key, text);
    }
    setCustomDraft((d) => ({ ...d, [key]: "" }));
    setCustomOpen((o) => ({ ...o, [key]: false }));
  }

  function removeCapsule(key: (typeof FIELD_ORDER)[number], isMulti: boolean, opt: string) {
    if (!isMulti || !icp) return;
    const f = icp[key];
    const current = f.value.split(",").map((s) => s.trim()).filter(Boolean);
    setIcp({
      ...icp,
      [key]: { ...f, value: current.filter((v) => v !== opt).join(", "), confirmed: current.length > 1 },
    });
  }

  function addCustomField() {
    const label = addFieldLabel.trim();
    const value = addFieldValue.trim();
    if (!label) return;
    setCustomFields((f) => (f.some((x) => x.label === label) ? f : [...f, { label, value }]));
    setAddFieldLabel("");
    setAddFieldValue("");
    setAddFieldOpen(false);
  }

  function removeCustomField(label: string) {
    setCustomFields((f) => f.filter((x) => x.label !== label));
  }

  function toggleMulti(key: (typeof FIELD_ORDER)[number], opt: string) {
    if (!icp) return;
    const f = icp[key];
    const current = f.value.split(",").map((s) => s.trim()).filter(Boolean);
    const next = current.includes(opt)
      ? current.filter((v) => v !== opt)
      : [...current, opt];
    const value = next.join(", ");
    setIcp({
      ...icp,
      [key]: {
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
    const confirmedIcp: Icp = { ...icp, custom: customFields };
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
          className="animate-rise relative overflow-hidden rounded-board border border-line bg-surface p-6 shadow-board"
        >
          {/* Electric hairline across the top edge of the scan card. */}
          <span
            aria-hidden
            className="absolute inset-x-6 top-0 h-0.5 opacity-60"
            style={{ background: "linear-gradient(90deg, transparent, var(--blue), transparent)" }}
          />
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
              className="press relative overflow-hidden rounded-board bg-blue px-5 py-3 text-sm font-semibold text-white shadow-lift transition hover:bg-blue-deep disabled:opacity-50 disabled:shadow-none"
            >
              {loading ? "Reading…" : "Scan"}
              {loading && <span aria-hidden className="sheen-overlay sheen-overlay--fast" />}
            </button>
          </div>

          {loading && (
            <div className="animate-fade mt-3 flex items-center gap-2 text-xs text-ink-60">
              <span className="animate-spin-slow h-3 w-3 rounded-full border-2 border-blue-soft border-t-blue" />
              Reading {scanned ?? "your site"} — {READING_STEPS[stepIdx % READING_STEPS.length]}
            </div>
          )}
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
            <BrandLogo
              size={36}
              assets={
                scan.brand.logoUrl && !scan.brand.generated
                  ? { ...DEFAULT_BRAND, ...scan.brand }
                  : DEFAULT_BRAND
              }
            />
            <div>
              <h2 className="text-lg font-bold text-ink">{scan.brand.agencyName}</h2>
              <p className="text-xs text-ink-40">{scan.domain}</p>
            </div>
          </div>
          <Chip tone="blue">{scan.sourcesUsed.length} sources read</Chip>
        </div>

        {scan.corrected && (
          <p className="mt-2 text-xs text-ink-40">Assuming you meant {scan.domain}.</p>
        )}

        {(!scan.brand.logoUrl || scan.brand.generated || scan.siteFailure) && (
          <div className="mt-2 rounded-board border border-warn/30 bg-warn-soft px-3 py-2">
            <p className="text-xs font-semibold text-warn">Website not available</p>
            <p className="mt-0.5 text-[11px] text-warn">
              We couldn&apos;t read a logo or a live site from this address. The platform stays on the default theme.
              Confirm below from other listings, or re-scan to retry.
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
            const isMultiField = MULTI_FIELDS.has(key);
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
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {isMultiField ? (
                      f.value.split(",").map((s) => s.trim()).filter(Boolean).map((v) => (
                        <span key={v} className="group inline-flex items-center gap-1 rounded-chip border border-blue bg-blue-soft px-2.5 py-1 text-xs font-semibold text-blue-deep">
                          {v}
                          <button
                            onClick={() => removeCapsule(key, true, v)}
                            aria-label={`Remove ${v}`}
                            className="text-blue/50 transition group-hover:text-blue"
                          >
                            ✕
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-[15px] font-medium text-ink">{f.value}</span>
                    )}
                  </div>
                ) : (
                  <p className="mt-1.5 text-sm text-ink-60">We&apos;re not sure. Pick any that apply:</p>
                )}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {(() => {
                    /* Picked options hide from the chip row — the capsules
                     * above already show them. Leaving them here painted
                     * the same chip twice. */
                    const picked = new Set(f.value.split(",").map((s) => s.trim()).filter(Boolean));
                    return f.options.filter((opt) => !picked.has(opt)).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => toggleMulti(key, opt)}
                        className="rounded-chip border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-60 transition hover:border-blue"
                      >
                        {opt}
                      </button>
                    ));
                  })()}
                  {/* "Add your own" capsule + inline input. */}
                  {customOpen[key] ? (
                    <span className="inline-flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={customDraft[key] ?? ""}
                        onChange={(e) => setDraft(key, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitCustom(key, isMultiField);
                          }
                          if (e.key === "Escape") setCustomOpen((o) => ({ ...o, [key]: false }));
                        }}
                        placeholder={FIELD_LABEL[key].toLowerCase()}
                        className="w-36 rounded-chip border border-blue bg-surface px-2.5 py-1 text-xs text-ink outline-none placeholder:text-ink-40"
                      />
                      <button
                        onClick={() => commitCustom(key, isMultiField)}
                        className="rounded-chip bg-blue px-2 py-0.5 text-[11px] font-semibold text-white"
                      >
                        Add
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setCustomOpen((o) => ({ ...o, [key]: true }))}
                      className="rounded-chip border border-dashed border-line-strong px-2.5 py-1 text-xs font-medium text-ink-40 transition hover:border-blue hover:text-blue"
                    >
                      + Add
                    </button>
                  )}
                </div>
                {f.sources.length > 0 && (
                  <p className="mt-2 text-[11px] text-ink-40">from {f.sources.join(", ")}</p>
                )}
              </div>
            );
          })}

          {/* User-added fields render like first-class cards. */}
          {customFields.map((cf, i) => (
            <div key={cf.label} className="animate-stagger rounded-board border border-line bg-page p-4" style={{ ["--i" as string]: FIELD_ORDER.length + i }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-40">{cf.label}</span>
                <button
                  onClick={() => removeCustomField(cf.label)}
                  aria-label={`Remove ${cf.label}`}
                  className="text-xs text-ink-40 transition hover:text-crit"
                >
                  ✕ remove
                </button>
              </div>
              <input
                value={cf.value}
                onChange={(e) =>
                  setCustomFields((list) => list.map((x) => (x.label === cf.label ? { ...x, value: e.target.value } : x)))
                }
                placeholder="Type here…"
                className="mt-1.5 w-full rounded-board border border-line bg-surface px-3 py-1.5 text-[15px] text-ink outline-none placeholder:text-ink-40 focus:border-blue"
              />
            </div>
          ))}

          {/* Add a brand-new field card. */}
          {addFieldOpen ? (
            <div className="rounded-board border border-dashed border-line-strong bg-page p-4">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-40">New field</span>
              <div className="mt-2 flex gap-2">
                <input
                  autoFocus
                  value={addFieldLabel}
                  onChange={(e) => setAddFieldLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && addFieldLabel.trim()) {
                      e.preventDefault();
                      addCustomField();
                    }
                  }}
                  placeholder="Label, e.g. Industries avoided"
                  className="min-w-0 flex-1 rounded-board border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-40 focus:border-blue"
                />
                <button
                  onClick={addCustomField}
                  disabled={!addFieldLabel.trim()}
                  className="rounded-board bg-blue px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Add field
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddFieldOpen(true)}
              className="w-full rounded-board border border-dashed border-line-strong px-3 py-3 text-xs font-semibold text-ink-40 transition hover:border-blue hover:text-blue"
            >
              ＋ Add your own field
            </button>
          )}
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
