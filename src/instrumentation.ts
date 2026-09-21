/**
 * Next.js instrumentation hook — runs once per server process at startup
 * (before any request is handled).
 *
 * Startup recovery: any run left "queued"/"running"/"loading" by a previous
 * process is marked failed with a clear reason, and persisted queue rows get
 * re-enqueued (see src/lib/runRecovery.ts).
 *
 * NOTE: this file is compiled for BOTH runtimes (nodejs + edge). The edge
 * graph cannot contain node: builtins, so next.config.ts aliases
 * "@/lib/startupSweep" to "@/lib/startupSweep.edgeStub" (a no-op) when
 * NEXT_RUNTIME is edge — the real sweep module only ever loads in nodejs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { runStartupSweep } = await import("@/lib/startupSweep");
    await runStartupSweep();
  } catch (e) {
    // Never block server startup on recovery — e.g. DB not migrated yet.
    console.warn("[recovery] startup sweep skipped:", (e as Error).message);
  }
}
