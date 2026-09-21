import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { packJson, readJson } from "@/lib/json";
import { IcpSchema, BrandAssets as BrandSchema } from "@/lib/types";
import { enqueue } from "@/pipeline/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The confirm card posts the (possibly corrected) ICP here. We persist it,
 * then enqueue the seven-stage pipeline. The run row already exists from
 * /api/scan, so this just flips it into the queue. Plan §5.2 → §5.8
 */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const run = await db.run.findUnique({ where: { id: runId }, include: { workspace: true } });
  if (!run) return NextResponse.json({ error: "run_not_found" }, { status: 404 });

  if (run.status === "running") {
    return NextResponse.json({ ok: true, runId, already: true });
  }

  const icpParsed = IcpSchema.safeParse(body.icp);
  if (!icpParsed.success) {
    return NextResponse.json({ error: "invalid_icp", detail: icpParsed.error.flatten() }, { status: 400 });
  }
  const icp = icpParsed.data;

  const brandParsed = BrandSchema.safeParse(
    readJson(run.workspace.brandJson, { agencyName: run.workspace.agencyName ?? "" })
  );
  if (!brandParsed.success) {
    return NextResponse.json({ error: "invalid_brand", detail: brandParsed.error.flatten() }, { status: 400 });
  }
  const brand = brandParsed.data;

  // Persist the confirmed ICP so a reload shows what was actually run.
  await db.workspace.update({
    where: { id: run.workspaceId },
    data: { icpJson: packJson(icp) },
  });
  await db.run.update({ where: { id: runId }, data: { status: "queued" } });

  enqueue({
    runId,
    workspaceId: run.workspaceId,
    domain: run.workspace.domain,
    icp,
    brand,
  });

  return NextResponse.json({ ok: true, runId });
}
