import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { providerStatus } from "@/providers";
import { queueDepth } from "@/pipeline/queue";
import { cacheStats } from "@/lib/cache";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ops dashboard feed: which half of each provider pair is live, queue depth,
 * cache hit-rate, recent failures. Observability from day one. Plan §9.8
 */
export async function GET() {
  const [providers, cache, recentFailures, recentRuns] = await Promise.all([
    Promise.resolve(providerStatus()),
    cacheStats(),
    db.failureLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    db.run.findMany({ orderBy: { startedAt: "desc" }, take: 10, include: { workspace: true } }),
  ]);

  return NextResponse.json({
    mode: env.providerMode,
    costCapCents: env.costCapCents,
    queue: queueDepth(),
    providers,
    cache,
    recentFailures: recentFailures.map((f) => ({
      stage: f.stage, reason: f.reason, url: f.url, at: f.createdAt.toISOString(),
    })),
    recentRuns: recentRuns.map((r) => ({
      id: r.id,
      agency: r.workspace.agencyName ?? r.workspace.domain,
      status: r.status,
      mode: r.mode,
      leads: r.leadCount,
      costCents: r.costCents,
      totalMs: r.totalMs,
      startedAt: r.startedAt.toISOString(),
    })),
  });
}
