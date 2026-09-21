import { env, useLive } from "@/lib/env";
import type { LlmProvider } from "./types";
import { log } from "@/lib/logger";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Extraction and personalization behind a strict JSON schema, with a token
 * cap per run. On any error, timeout or budget exhaustion the caller's
 * `fallback` is returned and tagged `template`, so a lead never loses its
 * opener — it just gets a slightly less specific one. Plan §5.8, App. C
 */

// Per-run token ledger. The old module-global counter was zeroed by
// resetLlmBudget() at the START of every run, so under MAX_CONCURRENT=6 a
// mid-flight run's own spend was un-counted by a freshly enqueued run and
// the cap enforced a race lottery instead of a budget. AsyncLocalStorage
// scopes the counter to each run's async chain without threading runId
// through every llm.json call site.
const runScope = new AsyncLocalStorage<{ runId: string }>();
const tokensByRun = new Map<string, number>();

/** Run `fn` with the LLM token ledger scoped to runId. */
export async function runLlmScope<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return runScope.run({ runId }, fn);
}

function activeRunId(): string | null {
  return runScope.getStore()?.runId ?? null;
}

const mock: LlmProvider = {
  name: "llm/mock",
  live: false,
  async json<T>({ fallback }: { fallback: T }) {
    return { value: fallback, origin: "template" as const };
  },
};

const live: LlmProvider = {
  name: "llm/anthropic",
  live: true,
  async json<T>({ system, prompt, maxTokens = 1400, fallback }: { system: string; prompt: string; maxTokens?: number; fallback: T }) {
    const runId = activeRunId();
    const spent = runId ? (tokensByRun.get(runId) ?? 0) : 0;
    if (spent > env.llm.maxTokensPerRun) {
      log("warn", "llm", "token budget exhausted — falling back to template");
      return { value: fallback, origin: "template" as const };
    }
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.keys.anthropic,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: env.llm.model,
          max_tokens: maxTokens,
          system: `${system}\n\nRespond with a single JSON object and nothing else.`,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const d = (await res.json()) as any;
      if (runId) {
        tokensByRun.set(
          runId,
          (tokensByRun.get(runId) ?? 0) + (d.usage?.input_tokens ?? 0) + (d.usage?.output_tokens ?? 0)
        );
      }

      const text: string = d.content?.[0]?.text ?? "";
      const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
      return { value: JSON.parse(jsonStr) as T, origin: "llm" as const };
    } catch (e) {
      log("warn", "llm", `falling back to template: ${(e as Error).message}`);
      return { value: fallback, origin: "template" as const };
    }
  },
};

export const llm: LlmProvider = useLive(env.keys.anthropic) ? live : mock;
/** Drop a finished run's ledger entry so the process map cannot grow unbounded. */
export function resetLlmBudget(runId?: string) {
  if (runId) tokensByRun.delete(runId);
  else tokensByRun.clear();
}
