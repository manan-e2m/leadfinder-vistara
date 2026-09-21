import { env, useLive } from "@/lib/env";
import type { AdLibraryProvider, AdActivity } from "./types";
import { rng, int, chance, pick } from "./fixtures";

const THEMES = ["new patient special","teeth whitening","same-day crowns","botox promotion","free consultation","seasonal offer","financing available"];

const mock: AdLibraryProvider = {
  name: "adlibrary/mock",
  live: false,
  async lookup({ businessName, domain }) {
    const r = rng(`ads|${businessName}`);
    // A business running ads has budget and intent — the two hardest things
    // to qualify — so this feeds ability-to-pay as well as the PPC audit.
    const advertising = chance(r, 0.3);
    return {
      advertiserFound: advertising,
      activeAdCount: advertising ? int(r, 1, 9) : 0,
      platforms: advertising
        ? (chance(r, 0.5) ? ["meta", "google"] : [pick(r, ["meta", "google"] as const)])
        : [],
      destinationUrls: advertising && domain ? [`https://${domain}/`] : [],
      competitorsAdvertising: int(r, 0, 4),
      promotedThemes: advertising ? [pick(r, THEMES)] : [],
    };
  },
};

/** Meta Ad Library. Free. Query by page name; note active vs inactive. */
const live: AdLibraryProvider = {
  name: "adlibrary/meta",
  live: true,
  async lookup({ businessName, domain }) {
    const u = new URL("https://graph.facebook.com/v21.0/ads_archive");
    u.searchParams.set("access_token", env.keys.metaAds);
    u.searchParams.set("search_terms", businessName);
    u.searchParams.set("ad_reached_countries", '["US"]');
    u.searchParams.set("ad_active_status", "ACTIVE");
    u.searchParams.set("fields", "id,ad_snapshot_url,page_name");
    u.searchParams.set("limit", "25");

    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`ad library ${res.status}`);
    const d = (await res.json()) as { data?: unknown[] };
    const count = d.data?.length ?? 0;
    return {
      advertiserFound: count > 0,
      activeAdCount: count,
      platforms: count > 0 ? ["meta"] : [],
      destinationUrls: domain && count > 0 ? [`https://${domain}/`] : [],
      competitorsAdvertising: 0,
      promotedThemes: [],
    };
  },
};

export const adlibrary: AdLibraryProvider = useLive(env.keys.metaAds) ? live : mock;
