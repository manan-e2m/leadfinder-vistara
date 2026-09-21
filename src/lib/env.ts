/** Central, typed access to configuration. Nothing else reads process.env. */

const str = (k: string, d = "") => process.env[k]?.trim() || d;
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : d;
};

export type ProviderMode = "auto" | "mock" | "live";

export const env = {
  appUrl: str("APP_URL", "http://localhost:3100"),
  databaseUrl: str("DATABASE_URL", "file:./dev.db"),

  /**
   * Optional shared secret for the /ops dashboard. When set, /api/providers
   * requires it (Authorization: Bearer <token> or ?token=<token>) and /ops
   * shows a token gate. When unset (demo default), ops is open as before.
   */
  opsToken: str("OPS_TOKEN"),

  /** auto = use a live adapter wherever its key exists, mock otherwise. */
  providerMode: str("PROVIDER_MODE", "auto") as ProviderMode,

  costCapCents: num("COST_CAP_CENTS", 45),

  keys: {
    places: str("GOOGLE_PLACES_API_KEY"),
    apollo: str("APOLLO_API_KEY"),
    pagespeed: str("PAGESPEED_API_KEY"),
    metaAds: str("META_AD_LIBRARY_TOKEN"),
    phoneVerify: str("PHONE_VERIFY_API_KEY"),
    emailVerify: str("EMAIL_VERIFY_API_KEY"),
    anthropic: str("ANTHROPIC_API_KEY"),
    ghl: str("GHL_API_KEY"),
    ghlLocation: str("GHL_LOCATION_ID"),
    hubspot: str("HUBSPOT_ACCESS_TOKEN"),
    resend: str("RESEND_API_KEY"),
    benchmarkCorpus: str("E2M_BENCHMARK_CORPUS_URL"),
  },

  llm: {
    model: str("LLM_MODEL", "claude-sonnet-4-5"),
    maxTokensPerRun: num("LLM_MAX_TOKENS_PER_RUN", 40_000),
  },
} as const;

/**
 * A live adapter is used only when the mode allows it AND its key exists.
 * This is the whole switch: no key means the mock runs, and the platform
 * stays fully functional. Add a key, restart, and that one stage goes live.
 */
export function useLive(key: string): boolean {
  if (env.providerMode === "mock") return false;
  if (env.providerMode === "live") return true;
  return Boolean(key);
}
