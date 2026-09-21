import { getRunResults } from "@/lib/results";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CSV always works, and never depends on a CRM integration being reachable.
 * This is the export every agency owner can use immediately. Plan §11.1
 */
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADERS = [
  "rank", "score", "fit", "pain", "pay", "reach",
  "business", "website", "phone", "city", "region",
  "rating", "reviews", "source", "services", "headline_gap", "benchmark",
  "top_findings", "email_subject", "email_opener", "phone_opener", "audit_url",
];

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const view = await getRunResults(runId);
  if (!view) return new Response("run not found", { status: 404 });

  const rows = view.leads.map((l) => [
    l.rank, l.score, l.breakdown.fit, l.breakdown.pain, l.breakdown.pay, l.breakdown.reach,
    l.business.name, l.business.website, l.business.phone, l.business.city, l.business.region,
    l.business.rating, l.business.reviewCount, l.business.source, l.tagLabel, l.headlineGap, l.benchmark ?? "",
    l.signals.slice(0, 3).map((s) => `${s.label}: ${s.measurement}`).join(" | "),
    l.openers.email?.subject ?? "",
    l.openers.email?.body ?? "",
    l.openers.phone?.body ?? "",
    l.auditToken ? `${env.appUrl}/audit/${l.auditToken}` : "",
  ]);

  const csv = [HEADERS, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (view.workspace.agencyName ?? view.workspace.domain).replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leadfinder-${slug}-${stamp}.csv"`,
    },
  });
}
