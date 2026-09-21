/**
 * Next.js instrumentation hook — runs once per server process at startup
 * (before any request is handled).
 *
 * Startup recovery: any run left "queued"/"running"/"loading" by a previous
 * process is marked failed with a clear reason, and persisted queue rows get
 * re-enqueued (see src/lib/runRecovery.ts).
 *
 * NOTE: this file is compiled for BOTH runtimes (nodejs + edge). The edge
 * graph cannot contain node: builtins, so the sweep loader below keeps the
 * import out of webpack's static analysis via eval. The sweep itself lives
 * in src/lib/startupSweep.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const mod = await eval("import('@/lib/startupSweep')");
    await (mod as { runStartupSweep: () => Promise<void> }).runStartupSweep();
  } catch (e) {
    // Never block server startup on recovery — e.g. DB not migrated yet.
    console.warn("[recovery] startup sweep skipped:", (e as Error).message);
  }
}
