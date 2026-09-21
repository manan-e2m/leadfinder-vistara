import Link from "next/link";
import { notFound } from "next/navigation";
import { getRunResults } from "@/lib/results";
import { rawRunForLinkGuard, isLinkExpired } from "@/lib/linkGuard";
import LeadList from "@/components/LeadList";
import { Wordmark, Chip } from "@/components/ui";

export const dynamic = "force-dynamic";

const FALLBACK_COPY: Record<string, string> = {
  route: "Route was defaulted while a better vertical match retried in the background.",
  source: "Sourcing degraded. We showed cached results.",
  "audit:cost_cap": "Cost cap reached, so some audits were skipped.",
  "score:fit_only": "Audits didn't complete. Ranked on fit alone.",
};

/**
 * "Why fewer leads" — built only from the run's own numbers and fallback
 * flags, never filler. Rendered when a run passes fewer than 5 leads so an
 * agency owner doesn't read a short list as a broken tool.
 */
function fewerLeadsExplainer(view: NonNullable<Awaited<ReturnType<typeof getRunResults>>>): string {
  const c = view.counts;
  const reasons: string[] = [];
  if (c.heldBack > 0)
    reasons.push(`${c.heldBack} prospects were held back on verification (bad phone, closed, or missing site) — we never pad the list with them.`);
  if (view.fallbacks.includes("audit:cost_cap")) reasons.push("the cost cap stopped some audits partway.");
  if (view.fallbacks.includes("score:fit_only")) reasons.push("audits didn't complete, so ranking ran on fit alone.");
  if (view.fallbacks.includes("source") || view.fallbacks.includes("route")) reasons.push("sourcing was degraded and used cached listings only.");
  if (c.candidate > 0 && c.candidate < 5) reasons.push(`only ${c.candidate} candidates matched this vertical/geo in our source coverage.`);
  const tail = reasons.length ? ` This short list is because ${reasons.join(" ")}` : " Vertical coverage and filter strictness vary by metro — a re-scan with a wider vertical or a nearby metro usually returns more.";
  return `${c.candidate} businesses were sourced and audited; ${c.lead} cleared every check.${tail}`;
}

export default async function ResultsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;

  /* Opt-in expiry guard: only active when RESULT_LINK_TTL_HOURS > 0. */
  const raw = await rawRunForLinkGuard(runId);
  if (raw && isLinkExpired(raw)) {
    return <ExpiredNotice />;
  }

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
            {view.status === "degraded" && <Chip tone="warn">degraded, still real</Chip>}
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
              No prospects cleared verification this time. That&apos;s the honest result. We never pad the
              list to hit a number.
            </p>
            <p className="mt-3 text-xs text-ink-40">{fewerLeadsExplainer(view)}</p>
            <Link href="/" className="mt-3 inline-block text-sm font-semibold text-blue hover:text-blue-deep">
              Try another scan
            </Link>
          </div>
        ) : (
          <>
            {view.leads.length < 5 && (
              <p className="mb-4 rounded-board border border-line bg-surface-2 px-4 py-2.5 text-xs leading-relaxed text-ink-60">
                <span className="font-semibold text-ink">Why fewer leads: </span>
                {fewerLeadsExplainer(view)}
              </p>
            )}
            <LeadList view={view} />
          </>
        )}
      </div>
    </main>
  );
}

/** Shown only when RESULT_LINK_TTL_HOURS is set and the run is past it. */
function ExpiredNotice() {
  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-board items-center justify-between px-6 py-3.5">
          <Link href="/"><Wordmark /></Link>
        </div>
      </header>
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <h1 className="text-xl font-bold text-ink">This results link has expired</h1>
        <p className="mt-2 text-sm text-ink-60">
          Result links are kept for a limited time after a scan. Run a fresh scan to
          see current, verified prospects.
        </p>
        <Link href="/" className="mt-6 inline-block rounded-board bg-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-deep">
          New scan
        </Link>
      </div>
    </main>
  );
}
