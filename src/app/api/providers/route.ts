import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { providerStatus } from "@/providers";
import { queueDepth } from "@/pipeline/queue";
import { cacheStats } from "@/lib/cache";
import { env } from "@/lib/env";
import { STALE_AFTER_MS } from "@/lib/runRecovery";
import { checkOpsToken } from "@/lib/opsGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Non-terminal statuses a recoverable (stale) run can be stuck in. */
const NON_TERMINAL = ["queued", "running", "loading"];

/**
 * Ops dashboard feed: which half of each provider pair is live, queue depth,
 * cache hit-rate, recent failures. Observability from day one. Plan §9.8
 *
 * When OPS_TOKEN is set, requires Bearer auth / x-ops-token / ?token=.
 * When unset (demo default), open access.
 */
export async function GET(req: Request) {
  if (!checkOpsToken(req)) {
    return NextResponse.json(
      { error: "ops token required" },
      { status: 401, headers: { "www-authenticate": "Bearer" } }
    );
  }
  const [providers, cache, recentFailures, recentRuns, staleCount] = await Promise.all([
    Promise.resolve(providerStatus()),
    cacheStats(),
    db.failureLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    db.run.findMany({ orderBy: { startedAt: "desc" }, take: 10, include: { workspace: true } }),
    // Runs-snapshot: how many non-terminal runs look orphaned (recovery-needed).
    db.run.count({
      where: {
        status: { in: NON_TERMINAL },
        startedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) },
      },
    }),
  ]);

  return NextResponse.json({
    mode: env.providerMode,
    costCapCents: env.costCapCents,
    queue: queueDepth(),
    providers,
    cache,
    runsSnapshot: {
      staleNonTerminal: staleCount,
      staleAfterMs: STALE_AFTER_MS,
    },
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
