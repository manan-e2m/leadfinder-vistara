/**
 * Startup sweep — called only from the nodejs runtime by
 * src/instrumentation.ts.
 *
 * Order matters: reap first (flips every orphaned run to failed), THEN
 * re-enqueue persisted queue rows (what survives is genuinely un-started
 * work from before the restart).
 */
export async function runStartupSweep(): Promise<void> {
  const { reapStaleRuns, reenqueuePersistedQueues } = await import("@/lib/runRecovery");
  const { enqueue } = await import("@/pipeline/queue");
  await reapStaleRuns();
  await reenqueuePersistedQueues(enqueue);
}
