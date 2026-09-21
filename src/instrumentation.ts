/**
 * Next.js instrumentation hook — runs once per server process at startup
 * (before any request is handled).
 *
 * Startup recovery sweep: any run left "queued"/"running"/"loading" by a
 * previous process (deploy, crash, dev reload) is past staleness by the
 * time the new process boots, so it is marked failed with a clear reason
 * instead of spinning forever on the progress screen.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { reapStaleRuns } = await import("@/lib/runRecovery");
    await reapStaleRuns();
  } catch (e) {
    // Never block server startup on recovery — e.g. DB not migrated yet.
    console.warn("[recovery] startup sweep skipped:", (e as Error).message);
  }
}
