import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { readJson } from "@/lib/json";
import { brandCssVars } from "@/lib/brandTheme";
import { env } from "@/lib/env";
import type { BrandAssets } from "@/lib/types";
import CopyAuditLink from "./CopyAuditLink";

export const dynamic = "force-dynamic";

/**
 * The one-page white-labeled audit. The AGENCY's logo and colours, the
 * PROSPECT's name, the findings with evidence. E2M does the work; the
 * agency's name goes on it. A public, unguessable share token. Plan §5.6
 */
export default async function AuditPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const doc = await db.auditDoc.findUnique({
    where: { token },
    include: { lead: { include: { candidate: true } } },
  });
  if (!doc) notFound();

  const brand = readJson<BrandAssets>(doc.brandJson, {
    logoUrl: null, primary: "#0F6B6B", secondary: "#08090C",
    tone: "", agencyName: "Your agency", neutral: true, generated: false,
  });
  const findings = readJson<{ label: string; measurement: string }[]>(doc.findingsJson, []);
  const prospect = doc.lead.candidate;
  const shareUrl = `${env.appUrl.replace(/\/$/, "")}/audit/${token}`;

  return (
    <main
      className="min-h-screen bg-page"
      style={brandCssVars(brand)}
    >
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="animate-rise-in overflow-hidden rounded-board border border-line bg-surface shadow-board">
          {/* Agency-branded header bar — the gradient deepens the agency's own
              colour toward the corner; a slow sheen sweeps across it. */}
          <div
            className="relative overflow-hidden px-8 py-6 text-white"
            style={{
              background:
                "linear-gradient(135deg, var(--brand-primary), color-mix(in srgb, var(--brand-primary) 68%, #000))",
            }}
          >
            <span aria-hidden className="sheen-overlay sheen-overlay--loop" />
            <div className="relative flex items-center justify-between">
              <span className="flex items-center gap-3">
                {brand.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brand.logoUrl}
                    alt={`${brand.agencyName || "Agency"} logo`}
                    className="h-8 w-8 rounded bg-white/90 object-contain p-0.5"
                  />
                ) : (
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold text-white ring-1 ring-white/40"
                    style={{ background: brand.generated ? brand.primary : "rgba(255,255,255,0.18)" }}
                  >
                    {(brand.agencyName || "A").trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="text-sm font-bold tracking-tight">
                  {brand.agencyName || "Your agency"}
                </span>
              </span>
              <span className="text-[11px] uppercase tracking-widest opacity-80">Website & marketing audit</span>
            </div>
            {brand.generated && (
              <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
                Using generated brand
              </p>
            )}
          </div>

          <div className="px-8 py-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-40">
              Made for {brand.agencyName || "your agency"}&apos;s prospect
            </p>
            <h1 className="mt-1 text-2xl font-bold text-ink">{prospect.name}</h1>
            {prospect.website && <p className="text-sm text-ink-40">{prospect.website}</p>}

            <div className="mt-6">
              <h2 className="text-sm font-bold text-ink">What we found</h2>
              <ul className="mt-3 space-y-3">
                {findings.length === 0 ? (
                  <li className="text-sm text-ink-60">
                    A short discovery call will confirm the priorities for {prospect.name}.
                  </li>
                ) : (
                  findings.map((f, i) => (
                    <li key={i} className="animate-stagger rounded-board border border-line bg-page p-4" style={{ ["--i" as string]: i }}>
                      <div className="flex items-start gap-3">
                        <span
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                          style={{ background: brand.primary }}
                        >
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-ink">{f.label}</p>
                          <p className="mt-0.5 font-mono text-xs text-ink-80">{f.measurement}</p>
                        </div>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="mt-6 rounded-board p-4" style={{ background: "var(--brand-soft, #e5f2f2)" }}>
              <h3 className="text-sm font-bold" style={{ color: "var(--brand-primary)" }}>Recommended next step</h3>
              <p className="mt-1 text-sm text-ink-80">{doc.planSummary}</p>
            </div>

            {brand.generated && (
              <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-ink-40">
                Using generated brand
              </p>
            )}

            <p className="mt-6 border-t border-line pt-4 text-[11px] text-ink-40">
              Prepared by {brand.agencyName || "your agency"}. Findings are measured from public signals and
              may change as sites are updated.
            </p>
          </div>
        </div>

        {/* One-click copy for the person sharing this audit. */}
        <div className="mt-4 flex items-center justify-center gap-3">
          <span className="max-w-xs truncate font-mono text-[10px] text-ink-40">{shareUrl}</span>
          <CopyAuditLink url={shareUrl} />
        </div>

        {/* The ad for the platform — visible on every shared copy. */}
        <p className="mt-4 text-center text-[11px] text-ink-40">
          Generated by{" "}
          <a href="/" className="font-semibold text-blue hover:text-blue-deep">
            E2M LeadFinder
          </a>{" "}
          — audits like this, plus verified leads, in about a minute.
        </p>
      </div>
    </main>
  );
}
