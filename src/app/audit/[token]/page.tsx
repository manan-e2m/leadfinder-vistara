import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { readJson } from "@/lib/json";
import type { BrandAssets } from "@/lib/types";

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
    tone: "", agencyName: "Your agency", neutral: true,
  });
  const findings = readJson<{ label: string; measurement: string }[]>(doc.findingsJson, []);
  const prospect = doc.lead.candidate;

  return (
    <main
      className="min-h-screen bg-page"
      style={{ ["--agency" as string]: brand.primary }}
    >
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="overflow-hidden rounded-board border border-line bg-surface shadow-sm">
          {/* Agency-branded header bar */}
          <div className="px-8 py-6 text-white" style={{ background: brand.primary }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold tracking-tight">
                {brand.agencyName || "Your agency"}
              </span>
              <span className="text-[11px] uppercase tracking-widest opacity-80">Website & marketing audit</span>
            </div>
          </div>

          <div className="px-8 py-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-40">Prepared for</p>
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
                    <li key={i} className="rounded-board border border-line bg-page p-4">
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

            <div className="mt-6 rounded-board p-4" style={{ background: "var(--agency-soft, #e5f2f2)" }}>
              <h3 className="text-sm font-bold" style={{ color: brand.primary }}>Recommended next step</h3>
              <p className="mt-1 text-sm text-ink-80">{doc.planSummary}</p>
            </div>

            <p className="mt-6 border-t border-line pt-4 text-[11px] text-ink-40">
              Prepared by {brand.agencyName || "your agency"}. Findings are measured from public signals and
              may change as sites are updated.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
