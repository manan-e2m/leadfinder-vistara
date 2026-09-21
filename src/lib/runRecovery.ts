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
