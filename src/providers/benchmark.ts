import { env, useLive } from "@/lib/env";
import type { BenchmarkProvider } from "./types";

/**
 * E2M's delivery history is the one thing no competitor in that room can
 * reproduce. Nothing else in the pipeline is a moat — any competent team
 * could build it, and some attendees have. Plan §8
 *
 * Critically, this layer is ADDITIVE. If the anonymized corpus is not
 * available by week 6, `compare` returns null and the benchmark line is
 * simply absent. It is never approximated, and never invented: a fabricated
 * benchmark in front of Mike King is the same failure as a fabricated lead.
 */

const unavailable: BenchmarkProvider = {
  name: "benchmark/unavailable",
  live: false,
  async compare() { return null; },
};

/** Percentile table derived from the anonymized corpus of delivered sites. */
const live: BenchmarkProvider = {
  name: "benchmark/e2m-corpus",
  live: true,
  async compare({ metric, value }) {
    try {
      const res = await fetch(
        `${env.keys.benchmarkCorpus}?metric=${encodeURIComponent(metric)}&value=${value}`,
        { signal: AbortSignal.timeout(8_000) }
      );
      if (!res.ok) return null;
      const d = (await res.json()) as { percentile?: number; sample?: number; delta?: string };
      if (typeof d.percentile !== "number") return null;

      const band =
        d.percentile <= 25 ? "bottom quartile"
        : d.percentile <= 50 ? "bottom half"
        : d.percentile <= 75 ? "top half"
        : "top quartile";

      return `${band} of the ${(d.sample ?? 10_000).toLocaleString()}+ sites E2M has built or optimized${d.delta ? `. ${d.delta}` : "."}`;
    } catch {
      return null;
    }
  },
};

export const benchmark: BenchmarkProvider =
  useLive(env.keys.benchmarkCorpus) ? live : unavailable;
