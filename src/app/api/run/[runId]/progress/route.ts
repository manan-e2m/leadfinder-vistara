import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PIPELINE_STEPS, progressFor, fallbacksOf } from "@/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The honest progress screen polls this. It names the seven steps, marks each
 * ok / fallback / failed from the stage log, and surfaces the live label of
 * whatever is running right now. It never claims a step finished that didn't.
 * Plan §5, §9.5, App. C
 */
export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;

  const run = await db.run.findUnique({
    where: { id: runId },
    include: { stageLogs: true },
  });
  if (!run) return NextResponse.json({ error: "run_not_found" }, { status: 404 });

  const logByStage = new Map<string, { status: string; reason: string | null; ms: number }>();
  for (const s of run.stageLogs) logByStage.set(s.stage, { status: s.status, reason: s.reason, ms: s.ms });

  const terminal = ["complete", "degraded", "failed"].includes(run.status);

  const stages = PIPELINE_STEPS.map((step, i) => {
    const logged = logByStage.get(step.key);
    let status: "pending" | "running" | "ok" | "fallback" | "failed";

    if (step.key === "icp") {
      status = "ok"; // inferred at scan, before the run was queued
    } else if (logged) {
      status = logged.status === "failed" ? "failed" : logged.status === "fallback" ? "fallback" : "ok";
    } else if (step.key === "score" || step.key === "personalize") {
      status = run.leadCount > 0 ? "ok" : terminal ? "failed" : "pending";
    } else {
      status = "pending";
    }

    // The first non-terminal pending step is the one currently running.
    if (!terminal && status === "pending") {
      const priorAllDone = PIPELINE_STEPS.slice(0, i).every((p) => {
        const l = logByStage.get(p.key);
        return p.key === "icp" || (l && l.status !== "failed") || (p.key === "score" && run.leadCount > 0);
      });
      if (priorAllDone && run.status === "running") status = "running";
    }

    return {
      key: step.key,
      label: step.label,
      status,
      reason: logged?.reason ?? null,
      ms: logged?.ms ?? null,
    };
  });

  const live = progressFor(runId);

  return NextResponse.json({
    runId,
    status: run.status,
    terminal,
    live,
    stages,
    counts: {
      candidate: run.candidateCount,
      audited: run.auditedCount,
      heldBack: run.heldBackCount,
      lead: run.leadCount,
    },
    costCents: run.costCents,
    cappedAt: run.cappedAt ? run.cappedAt.toISOString() : null,
    totalMs: run.totalMs,
    fallbacks: fallbacksOf(run),
  });
}
