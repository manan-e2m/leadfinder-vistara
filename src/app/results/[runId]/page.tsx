import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunResults } from "@/lib/results";
import LeadList from "@/components/LeadList";
import { Wordmark, Chip } from "@/components/ui";

export const dynamic = "force-dynamic";

const FALLBACK_COPY: Record<string, string> = {
  route: "Route was defaulted while a better vertical match retried in the background.",
  source: "Sourcing degraded — showed cached results.",
  "audit:cost_cap": "Cost cap reached — some audits were skipped.",
  "score:fit_only": "Audits didn't complete — ranked on fit alone.",
};

export default async function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const view = await getRunResults(runId);
  if (!view) notFound();

  const title = view.workspace.agencyName ?? view.workspace.domain;

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-board items-center justify-between px-6 py-3.5">
          <Link href="/"><Wordmark /></Link>
          <Link href="/" className="text-xs font-medium text-blue hover:text-blue-deep">
            New scan
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Prospects for {title}</h1>
            {view.status === "degraded" && <Chip tone="warn">degraded — still real</Chip>}
            {view.mode === "precomputed" && <Chip tone="blue">precomputed</Chip>}
          </div>
          <p className="mt-1.5 text-sm text-ink-60">
            {view.counts.candidate} sourced · {view.counts.audited} audited · {view.counts.heldBack} held back on
            verification · <span className="font-medium text-ink-80">{view.counts.lead} passed</span>
            {view.totalMs != null && ` · ${(view.totalMs / 1000).toFixed(1)}s`}
            {` · ${view.costCents.toFixed(1)}¢`}
          </p>

          {view.fallbacks.length > 0 && (
            <div className="mt-3 rounded-board border border-warn/30 bg-warn-soft px-3 py-2">
              <p className="text-xs font-semibold text-warn">What degraded, honestly:</p>
              <ul className="mt-1 space-y-0.5">
                {view.fallbacks.map((f) => (
                  <li key={f} className="text-[11px] text-warn">• {FALLBACK_COPY[f] ?? f}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {view.leads.length === 0 ? (
          <div className="rounded-board border border-line bg-surface p-8 text-center">
            <p className="text-sm text-ink-60">
              No prospects cleared verification this time. That&apos;s the honest result — nothing padded to
              hit a number.
            </p>
            <Link href="/" className="mt-3 inline-block text-sm font-semibold text-blue hover:text-blue-deep">
              Try another scan
            </Link>
          </div>
        ) : (
          <LeadList view={view} />
        )}
      </div>
    </main>
  );
}
