import { env, useLive } from "@/lib/env";
import type { PageSpeedProvider, PageSpeedResult } from "./types";
import { rng, int, chance } from "./fixtures";

const mock: PageSpeedProvider = {
  name: "pagespeed/mock",
  live: false,
  async run(url) {
    const r = rng(`psi|${url}`);
    // Weighted so roughly a third of prospects are genuinely bad — which is
    // what makes a lead list worth having, and matches what audits find.
    const bad = chance(r, 0.34);
    const mid = !bad && chance(r, 0.4);
    const mobileScore = bad ? int(r, 12, 39) : mid ? int(r, 40, 68) : int(r, 69, 96);
    return {
      mobileScore,
      lcpSeconds: Number((bad ? 5.4 + r() * 4.5 : mid ? 3 + r() * 2.2 : 1.2 + r() * 1.5).toFixed(1)),
      clsScore: Number((bad ? 0.18 + r() * 0.24 : r() * 0.1).toFixed(2)),
      totalBytesMb: Number((bad ? 2.4 + r() * 3 : 0.6 + r() * 1.4).toFixed(1)),
      fieldData: chance(r, 0.7),
    };
  },
};

/** PageSpeed Insights / CrUX. Free, rate limited — batch during pre-compute. */
const live: PageSpeedProvider = {
  name: "pagespeed/google",
  live: true,
  async run(url) {
    const u = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    u.searchParams.set("url", url.startsWith("http") ? url : `https://${url}`);
    u.searchParams.set("strategy", "mobile");
    u.searchParams.set("category", "performance");
    if (env.keys.pagespeed) u.searchParams.set("key", env.keys.pagespeed);

    const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const lh = d.lighthouseResult;
    if (!lh) return null;
    return {
      mobileScore: Math.round((lh.categories?.performance?.score ?? 0) * 100),
      lcpSeconds: Number(((lh.audits?.["largest-contentful-paint"]?.numericValue ?? 0) / 1000).toFixed(1)),
      clsScore: Number((lh.audits?.["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(2)),
      totalBytesMb: Number(((lh.audits?.["total-byte-weight"]?.numericValue ?? 0) / 1048576).toFixed(1)),
      fieldData: Boolean(d.loadingExperience?.metrics),
    };
  },
};

export const pagespeed: PageSpeedProvider = useLive(env.keys.pagespeed) ? live : mock;
