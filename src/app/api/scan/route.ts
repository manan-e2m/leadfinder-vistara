import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { packJson } from "@/lib/json";
import { normalizeDomain, agencyNameFromDomain } from "@/lib/domain";
import { RunBudget } from "@/lib/cost";
import { inferIcp, needsConfirmation } from "@/pipeline/stages/icp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stage 1 → 2. Capture a domain, infer the ICP across six sources in
 * parallel, and hand back the confirm card. Teammates from one agency
 * dedupe onto one workspace (keyed on registrable domain). Plan §5.1–5.2
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const norm = normalizeDomain(String(body.input ?? ""));
  if (!norm.ok) {
    return NextResponse.json(
      { error: "not_a_domain", message: "That doesn't look like a website. Try e.g. acmeagency.com" },
      { status: 400 }
    );
  }

  const domain = norm.domain;
  const providedName = String(body.agencyName ?? "").trim();
  const agencyName = providedName || agencyNameFromDomain(domain);

  // Only overwrite the stored name when the caller explicitly provides one —
  // never clobber a hand-QA'd name (from the registration list / precompute)
  // with a domain-derived guess. Plan §6.7
  const workspace = await db.workspace.upsert({
    where: { domain },
    update: providedName ? { agencyName: providedName } : {},
    create: { domain, agencyName },
  });

  // Create the run up front so ICP-inference cost charges against a real row.
  const run = await db.run.create({
    data: { workspaceId: workspace.id, status: "queued", mode: "live" },
  });

  const budget = new RunBudget(run.id);
  const inferred = await inferIcp({ domain, agencyName, budget });
  await budget.flush();

  await db.workspace.update({
    where: { id: workspace.id },
    data: { icpJson: packJson(inferred.icp), brandJson: packJson(inferred.brand) },
  });

  return NextResponse.json({
    workspaceId: workspace.id,
    runId: run.id,
    domain,
    corrected: norm.corrected,
    icp: inferred.icp,
    brand: inferred.brand,
    sourcesUsed: inferred.sourcesUsed,
    fellBackToQuestions: inferred.fellBackToQuestions,
    siteFailure: inferred.siteFailure,
    needsConfirmation: needsConfirmation(inferred.icp),
  });
}
