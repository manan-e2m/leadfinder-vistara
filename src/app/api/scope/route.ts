import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { packJson } from "@/lib/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Have us scope and deliver this" — one tap, pre-filled, routed to the
 * partner team. The whole upsell. Identity is only ever requested here (or at
 * CRM push), never to see results. Plan §7.1, §7.3
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const leadId = String(body.leadId ?? "");
  // Unbounded, unvalidated strings went straight into DB writes: a 1MB
  // "note" or a garbage contactEmail row per double-click. Cap lengths and
  // sanity-check the email shape before anything is persisted.
  const contactEmail = String(body.contactEmail ?? "").trim().slice(0, 320);
  const agencyName = String(body.agencyName ?? "").trim().slice(0, 120);
  const note = String(body.note ?? "").trim().slice(0, 2000);

  if (!leadId || !contactEmail) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail)) {
    return NextResponse.json({ error: "invalid_email", message: "That doesn't look like an email address." }, { status: 400 });
  }

  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: { candidate: { include: { signals: true } }, run: true },
  });
  if (!lead) return NextResponse.json({ error: "lead_not_found" }, { status: 404 });

  const payload = {
    business: lead.candidate.name,
    website: lead.candidate.website,
    score: lead.score,
    headlineGap: lead.headlineGap,
    services: lead.tagLabel,
    findings: lead.candidate.signals.map((s) => ({ label: s.label, measurement: s.measurement, service: s.service })),
  };

  const scope = await db.scopeRequest.create({
    data: {
      workspaceId: lead.run.workspaceId,
      leadId,
      contactEmail,
      agencyName: agencyName || null,
      note: note || null,
      status: "new",
      payloadJson: packJson(payload),
    },
  });

  // Record the attendee identity captured at this moment of intent.
  await db.attendee.create({
    data: { workspaceId: lead.run.workspaceId, email: contactEmail, source: "walkin" },
  }).catch(() => {});

  return NextResponse.json({ ok: true, id: scope.id });
}
