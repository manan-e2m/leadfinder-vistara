/**
 * Next.js instrumentation hook — runs once per server process at startup
 * (before any request is handled).
 *
 * Startup recovery sweep: any run left "queued"/"running"/"loading" by a
 * previous process (deploy, crash, dev reload) is past staleness by the
 * time the new process boots, so it is marked failed with a clear reason
 * instead of spinning forever on the progress screen.
 *
 * Queue persistence sweep (AFTER the reap): the reaper has already failed
 * every orphaned run, so RunQueue rows still pointing at non-terminal runs
 * here belong to work that never got to start before the restart, not to
 * runs the reaper just condemned. Those are re-enqueued (capped) into the
 * fresh process's queue. Rows whose run is terminal (or whose re-enqueue
 * claim fails the status check) are simply skipped.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { reapStaleRuns, reenqueuePersistedQueues } = await import("@/lib/runRecovery");
    const { enqueue } = await import("@/pipeline/queue");
    await reapStaleRuns();
    await reenqueuePersistedQueues(enqueue);
  } catch (e) {
    // Never block server startup on recovery — e.g. DB not migrated yet.
    console.warn("[recovery] startup sweep skipped:", (e as Error).message);
  }
}
