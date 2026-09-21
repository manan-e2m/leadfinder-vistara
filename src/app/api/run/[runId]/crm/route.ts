import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRunResults } from "@/lib/results";
import { crmFor, type CrmContact } from "@/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GoHighLevel first, HubSpot second. Both retry once inside the adapter; if
 * either fails the client falls back to the CSV export rather than showing a
 * dead end. Detected gaps land as custom fields, not free text. Plan §11.1
 */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider ?? "ghl");

  const crm = crmFor(provider);
  if (!crm) return NextResponse.json({ error: "unknown_provider" }, { status: 400 });

  const view = await getRunResults(runId);
  if (!view) return NextResponse.json({ error: "run_not_found" }, { status: 404 });

  const contacts: CrmContact[] = view.leads.map((l) => ({
    name: l.business.name,
    phone: l.business.phone,
    email: null,
    website: l.business.website,
    city: l.business.city,
    tags: ["LeadFinder", l.tagLabel, `score-${l.score}`],
    customFields: {
      leadfinder_score: String(l.score),
      leadfinder_gap: l.headlineGap,
      leadfinder_services: l.tagLabel,
      ...Object.fromEntries(l.signals.slice(0, 3).map((s, i) => [`leadfinder_finding_${i + 1}`, `${s.label}: ${s.measurement}`])),
    },
  }));

  const result = await crm.push(contacts);

  await db.crmPush.create({
    data: {
      workspaceId: view.workspace.id,
      provider,
      status: result.ok ? "ok" : "failed",
      count: result.count,
      error: result.error ?? null,
    },
  });

  return NextResponse.json({ ...result, provider, live: crm.live });
}
