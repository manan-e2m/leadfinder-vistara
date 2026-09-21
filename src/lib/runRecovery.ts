/**
 * Stale-run recovery.
 *
 * The queue is in-process. If the server restarts (deploy, crash, dev
 * reload) mid-run, the run row is stuck at "queued"/"running" forever and
 * the progress screen spins. We cannot know a run was orphaned from the
 * row alone, so we use a staleness threshold: a non-terminal run that has
 * not been touched for STALE_AFTER_MS and is not in this process's
 * in-memory active set is marked failed with a clear message.
 */

import { db } from "./db";
import { log } from "./logger";
import { readJson } from "./json";
import { IcpSchema, BrandAssets as BrandSchemaAlias, type Icp, type BrandAssets } from "./types";

export const STALE_AFTER_MS = Number(process.env.RUN_STALE_AFTER_MS ?? 90_000);

/** Runs owned by THIS process's queue (queue.ts maintains this). */
declare global {
  // eslint-disable-next-line no-var
  var __leadfinderActiveRuns: Set<string> | undefined;
}
const activeRuns: Set<string> =
  (globalThis.__leadfinderActiveRuns ??= new Set<string>());

export function markRunActive(runId: string) {
  activeRuns.add(runId);
}
export function markRunInactive(runId: string) {
  activeRuns.delete(runId);
}

/** Row shape we need; passed in so both Prisma and test callers can use it. */
export interface StaleCheckRow {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
}

/** true when a run looks orphaned by a restart. */
export function isStaleRun(run: {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  /** heartbeat if the caller has one */
  updatedAt?: Date | null;
}): boolean {
  if (["complete", "degraded", "failed"].includes(run.status)) return false;
  if (activeRuns.has((run as StaleCheckRow).id)) return false;
  const lastTouched = run.updatedAt ?? run.startedAt;
  return Date.now() - new Date(lastTouched).getTime() > STALE_AFTER_MS;
}

/**
 * Mark one orphaned run failed. Idempotent: the update only matches rows
 * still in a non-terminal status.
 */
export async function failStaleRun(runId: string): Promise<void> {
  const reason = "Run interrupted by a server restart. Please start a new run.";
  await db.run.updateMany({
    where: { id: runId, status: { in: ["queued", "running", "loading"] } },
    data: { status: "failed", finishedAt: new Date() },
  });
  await db.failureLog
    .create({
      data: { stage: "recovery", reason, runId },
    })
    .catch(() => {});
  log("warn", "recovery", `marked stale run ${runId} failed: ${reason}`);
}

/** Reap every orphaned run at once (startup sweep). */
export async function reapStaleRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const candidates = await db.run.findMany({
    where: {
      status: { in: ["queued", "running", "loading"] },
      startedAt: { lt: cutoff },
    },
    select: { id: true },
  });
  const stale = candidates.filter((r) => !activeRuns.has(r.id));
  for (const r of stale) await failStaleRun(r.id);
  if (stale.length) log("warn", "recovery", `startup sweep: reaped ${stale.length} stale run(s)`);
  return stale.length;
}

/** How many queue rows we are willing to re-enqueue on one boot. */
export const REENQUEUE_CAP = 5;

/**
 * Re-enqueue persisted queue jobs (startup sweep, runs AFTER reapStaleRuns):
 * the reaper has already failed every orphaned in-flight run, so a RunQueue
 * row still attached to a non-terminal run here is work that was enqueued
 * before a restart but never started — rebuild its Job from the run +
 * workspace rows and hand it back through the real queue's enqueue path.
 * Rows whose run reached a terminal state are skipped (kept for audit).
 * Capped and safe to fail: a persistence miss just means the run stays
 * marked failed like before this model existed.
 */
export async function reenqueuePersistedQueues(enqueue: (job: {
  runId: string;
  workspaceId: string;
  domain: string;
  icp: Icp;
  brand: BrandAssets;
}) => void): Promise<number> {
  // Only runs a fresh boot could actually still execute: the start route
  // claims rows in exactly these two statuses.
  const CLAIMABLE_RUN_STATUSES = ["queued", "loading"] as const;
  const rows = await db.runQueue.findMany({
    where: { status: { in: ["queued", "running"] } },
    orderBy: { enqueuedAt: "asc" },
    take: REENQUEUE_CAP,
  });
  if (!rows.length) return 0;
  let count = 0;
  for (const row of rows) {
    // Claim-check the run itself: don't respawn terminal/crashed work just
    // because a queue row says so.
    const run = await db.run.findUnique({
      where: { id: row.runId },
      select: { status: true, workspaceId: true },
    });
    const claimable =
      run && (CLAIMABLE_RUN_STATUSES as readonly string[]).includes(run.status);
    if (!claimable) {
      await db.runQueue
        .update({ where: { runId: row.runId }, data: { status: "done" } })
        .catch(() => {});
      continue;
    }
    // Build the full Job shape for enqueue(): icp and brand live on the
    // workspace, same reads the start route does.
    const ws = await db.workspace.findUnique({
      where: { id: run!.workspaceId },
      select: { domain: true, icpJson: true, brandJson: true, agencyName: true },
    });
    // If these are unreadable, skip rather than crash the boot.
    if (!ws) {
      log("warn", "recovery", `cannot re-enqueue ${row.runId}: workspace missing`);
      continue;
    }
    const icp = IcpSchema.safeParse(readJson(ws.icpJson, null));
    if (!icp.success) {
      log("warn", "recovery", `cannot re-enqueue ${row.runId}: unreadable Icp`);
      continue;
    }
    const brand = BrandSchemaAlias.safeParse(
      readJson(ws.brandJson, { agencyName: ws.agencyName ?? "" })
    );
    if (!brand.success) {
      log("warn", "recovery", `cannot re-enqueue ${row.runId}: unreadable brand`);
      continue;
    }
    log("info", "recovery", `re-enqueueing ${row.runId} after restart`);
    enqueue({
      runId: row.runId,
      workspaceId: run!.workspaceId,
      domain: ws.domain,
      icp: icp.data,
      brand: brand.data,
    });
    await db.runQueue
      .update({ where: { runId: row.runId }, data: { status: "running" } })
      .catch(() => {});
    count++;
  }
  if (count) log("info", "recovery", `re-enqueued ${count} persisted queue row(s)`);
  return count;
}

/**
 * Called when a non-terminal run is queried: if it is stale, flip it to
 * failed and return true so the caller can say so.
 */
export async function recoverIfStale(
  run: { id: string; status: string; startedAt: Date; finishedAt: Date | null }
): Promise<boolean> {
  if (!isStaleRun(run)) return false;
  await failStaleRun(run.id);
  return true;
}
