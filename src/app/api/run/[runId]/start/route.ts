import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { packJson, readJson } from "@/lib/json";
import { IcpSchema, BrandAssets as BrandSchema } from "@/lib/types";
import { enqueue, isQueuedOrActive } from "@/pipeline/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The confirm card posts the (possibly corrected) ICP here. We persist it,
 * then enqueue the seven-stage pipeline. The run row already exists from
 * /api/scan, so this just flips it into the queue. Plan §5.2 → §5.8
 *
 * Idempotency (double-click guard): the claim to "queued" is a conditional
 * UPDATE that only matches non-terminal, non-running rows. Two racing POSTs
 * cannot both win it, and re-clicking start on a finished run never spawns
 * a second pipeline execution.
 */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const run = await db.run.findUnique({ where: { id: runId }, include: { workspace: true } });
  if (!run) return NextResponse.json({ error: "run_not_found" }, { status: 404 });

  // Already executing in this process (in-process lock) — do not enqueue again.
  if (run.status === "running" || isQueuedOrActive(runId)) {
    return NextResponse.json({ ok: true, runId, already: true });
  }

  // Terminal status: the run is finished. Never re-run it; a second start
  // would duplicate every lead. The client just navigates to the results.
  if (["complete", "degraded", "failed"].includes(run.status)) {
    return NextResponse.json({ ok: true, runId, already: true, terminal: true, status: run.status });
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

  // Atomic claim: only one caller can flip this run into the queue. If the
  // count is 0 another request already claimed (or finished) it.
  const claimed = await db.run.updateMany({
    where: { id: runId, status: { in: ["queued", "loading"] } },
    data: { status: "queued" },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ ok: true, runId, already: true });
  }

  enqueue({
    runId,
    workspaceId: run.workspaceId,
    domain: run.workspace.domain,
    icp,
    brand,
  });

  return NextResponse.json({ ok: true, runId });
}
