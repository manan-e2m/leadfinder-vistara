/**
 * Edge-runtime no-op stub for the startup sweep.
 *
 * next.config.ts aliases @/lib/startupSweep → this file when
 * NEXT_RUNTIME === "edge", so the instrumentation hook's dynamic import
 * resolves to nothing cost-free on the edge, where node: builtins
 * (dns/net/crypto used by the pipeline) cannot be bundled.
 *
 * Why not eval indirection in instrumentation.ts: vite/webpack aliasing is
 * deterministic and keeps the real sweep fully type-checked; eval broke
 * runtime alias resolution (@/ paths) in the compiled .next output.
 */
export async function runStartupSweep(): Promise<void> {}
