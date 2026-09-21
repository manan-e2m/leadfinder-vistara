import { useLive, env } from "@/lib/env";
import { isBlockedHostSync } from "@/lib/urlGuard";
import type { TechDetectProvider, TechProfile } from "./types";
import { rng, int, chance, pick } from "./fixtures";

const EMPTY: TechProfile = {
  reachable: false, failureKind: "dns", httpStatus: null, responseMs: 0,
  ssl: { valid: false, expiresInDays: null },
  cms: null, cmsVersion: null, themeLastUpdatedYear: null, storefront: null,
  analytics: { ga4: false, metaPixel: false, googleAds: false, tagManager: false },
  schema: { localBusiness: false, product: false, faq: false, review: false },
  hasViewportMeta: false, horizontalScrollAt390: false,
  chatWidget: false, bookingWidget: false, formEndpointHealthy: null,
  blogLatestPost: null, servicePages: [], locationPages: 0,
  checkoutLcpSeconds: null, reviewsApp: null, productCount: null,
  detectedServices: [], detectedVerticals: [],
  brandPrimaryColor: null, logoUrl: null,
};

const AGENCY_SERVICES = ["Local SEO","Web design","WordPress development","Paid social","Google Ads","Content marketing","Branding","eCommerce","Email marketing","AI automation"];
const AGENCY_VERTICALS = ["Dental & med-spa practices","Home services","Legal","Restaurants & hospitality","eCommerce brands","B2B SaaS","Healthcare","Real estate"];
const BRAND_COLORS = ["#0F6B6B","#1F3A93","#B3541E","#2E7D32","#5B2C6F","#0B7285","#8A2846","#354A5F"];

const mock: TechDetectProvider = {
  name: "techdetect/mock",
  live: false,
  async profile(url) {
    const r = rng(`tech|${url}`);

    // ~12% of sites are unreachable in one of the ways §6.2 enumerates.
    // These are the cases the fallback ladder exists for, so the mock has
    // to produce them or the ladder is never exercised.
    const roll = r();
    const failureKind: TechProfile["failureKind"] =
      url.startsWith("parked-") ? "wrong_site"
      : roll < 0.04 ? "empty_js_shell"
      : roll < 0.075 ? "challenge_403"
      : roll < 0.10 ? "timeout"
      : "none";

    if (failureKind !== "none") {
      return {
        ...EMPTY,
        reachable: false,
        failureKind,
        httpStatus: failureKind === "challenge_403" ? 403 : failureKind === "timeout" ? null : 200,
        responseMs: failureKind === "timeout" ? 10_000 : int(r, 300, 2200),
      };
    }

    const isWordpress = chance(r, 0.62);
    const storefront = !isWordpress && chance(r, 0.22)
      ? pick(r, ["shopify", "woocommerce", "bigcommerce"] as const)
      : null;
    const sslExpired = chance(r, 0.04);
    const blogAgeDays = chance(r, 0.42) ? int(r, 400, 1400) : int(r, 5, 300);

    return {
      reachable: true,
      failureKind: "none",
      httpStatus: 200,
      responseMs: int(r, 220, 3400),
      ssl: {
        valid: !sslExpired,
        expiresInDays: sslExpired ? -int(r, 1, 40) : int(r, 20, 300),
      },
      cms: isWordpress ? "WordPress" : storefront ? storefront : chance(r, 0.4) ? "Squarespace" : null,
      cmsVersion: isWordpress ? `${int(r, 5, 6)}.${int(r, 0, 9)}` : null,
      themeLastUpdatedYear: isWordpress ? int(r, 2018, 2026) : null,
      storefront,
      analytics: {
        ga4: chance(r, 0.58), metaPixel: chance(r, 0.41),
        googleAds: chance(r, 0.3), tagManager: chance(r, 0.36),
      },
      schema: {
        localBusiness: chance(r, 0.38), product: storefront ? chance(r, 0.35) : false,
        faq: chance(r, 0.22), review: chance(r, 0.19),
      },
      hasViewportMeta: chance(r, 0.88),
      horizontalScrollAt390: chance(r, 0.14),
      chatWidget: chance(r, 0.27),
      bookingWidget: chance(r, 0.33),
      formEndpointHealthy: chance(r, 0.07) ? false : true,
      blogLatestPost: new Date(Date.now() - blogAgeDays * 864e5),
      servicePages: Array.from({ length: int(r, 3, 8) }, (_, i) => ({
        url: `/services/${i + 1}`,
        words: chance(r, 0.4) ? int(r, 95, 260) : int(r, 380, 1400),
      })),
      locationPages: int(r, 0, 3),
      checkoutLcpSeconds: storefront ? Number((1.8 + r() * 5).toFixed(1)) : null,
      reviewsApp: storefront ? chance(r, 0.45) : null,
      productCount: storefront ? int(r, 8, 220) : null,
      detectedServices: Array.from(new Set(Array.from({ length: int(r, 2, 4) }, () => pick(r, AGENCY_SERVICES)))),
      detectedVerticals: Array.from(new Set(Array.from({ length: int(r, 1, 2) }, () => pick(r, AGENCY_VERTICALS)))),
      brandPrimaryColor: pick(r, BRAND_COLORS),
      logoUrl: null,
    };
  },
};

/**
 * Live detection: one fetch, header and HTML fingerprinting, which is
 * sufficient for most checks. A headless renderer handles JS-heavy sites
 * with a hard 8–10 s timeout and one retry maximum, never more, during the
 * event. Plan §5.8, §6.2
 */
const live: TechDetectProvider = {
  name: "techdetect/live",
  live: true,
  async profile(url) {
    // SSRF guard (cheap, literal-only): candidates' domains come from
    // provider responses, but a poisoned/misparsed record must not turn
    // into a fetch of localhost or a cloud metadata endpoint. Full DNS
    // resolution checks happen at the /api/scan boundary.
    if (isBlockedHostSync(url)) {
      return { ...EMPTY, failureKind: "dns", responseMs: 0 };
    }
    const target = url.startsWith("http") ? url : `https://${url}`;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(target, {
        redirect: "follow",
        headers: { "User-Agent": "E2M-LeadFinder/1.0 (+https://e2msolutions.com)" },
        signal: AbortSignal.timeout(9_000),
      });
    } catch (e) {
      const timeout = e instanceof Error && /timeout|abort/i.test(e.message);
      return { ...EMPTY, failureKind: timeout ? "timeout" : "dns", responseMs: Date.now() - started };
    }

    const responseMs = Date.now() - started;
    if (res.status === 403 || res.status === 503)
      return { ...EMPTY, failureKind: "challenge_403", httpStatus: res.status, responseMs };

    const html = await res.text().catch(() => "");
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    const textLen = body.replace(/<[^>]+>/g, " ").trim().length;
    if (textLen < 250)
      return { ...EMPTY, failureKind: "empty_js_shell", httpStatus: res.status, responseMs };

    const has = (re: RegExp) => re.test(html);
    const wpVersion = html.match(/content="WordPress ([\d.]+)"/i)?.[1] ?? null;
    const storefront: TechProfile["storefront"] =
      has(/cdn\.shopify\.com|Shopify\.theme/i) ? "shopify"
      : has(/woocommerce/i) ? "woocommerce"
      : has(/bigcommerce/i) ? "bigcommerce"
      : null;

    return {
      ...EMPTY,
      reachable: true,
      failureKind: "none",
      httpStatus: res.status,
      responseMs,
      ssl: { valid: target.startsWith("https"), expiresInDays: null },
      cms: wpVersion ? "WordPress" : storefront,
      cmsVersion: wpVersion,
      themeLastUpdatedYear: null,
      storefront,
      analytics: {
        ga4: has(/gtag\/js\?id=G-|googletagmanager\.com\/gtag/i),
        metaPixel: has(/connect\.facebook\.net|fbq\(/i),
        googleAds: has(/googleads\.g\.doubleclick|AW-\d+/i),
        tagManager: has(/googletagmanager\.com\/gtm\.js/i),
      },
      schema: {
        localBusiness: has(/"@type"\s*:\s*"(LocalBusiness|Dentist|MedicalBusiness)"/i),
        product: has(/"@type"\s*:\s*"Product"/i),
        faq: has(/"@type"\s*:\s*"FAQPage"/i),
        review: has(/"@type"\s*:\s*"(Review|AggregateRating)"/i),
      },
      hasViewportMeta: has(/<meta[^>]+name=["']viewport["']/i),
      chatWidget: has(/intercom|drift\.com|tawk\.to|crisp\.chat|tidio/i),
      bookingWidget: has(/calendly|acuityscheduling|zocdoc|squareup\.com\/appointments|nexhealth/i),
      brandPrimaryColor: html.match(/--(?:primary|brand)(?:-color)?\s*:\s*(#[0-9a-f]{3,8})/i)?.[1] ?? null,
      logoUrl: html.match(/<img[^>]+(?:class|id)=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i)?.[1] ?? null,
      detectedServices: [], detectedVerticals: [],
    };
  },
};

// No dedicated key — live detection is just an HTTP fetch, so it runs in
// auto mode like every other provider; only PROVIDER_MODE=mock (offline/
// event fallback) pins it synthetic. The old ternary returned mock in auto,
// contradicting both env.ts's docstring and the comment above it.
// techdetect is a plain HTTP fetch with no API key — unlike keyed providers
// there is no cost gate, so in auto mode it runs LIVE. (The old guard
// `mode === "live" ? live : mock` pinned the mock in auto, whose random
// BRAND_COLORS pick then overrode the real extracted brand colour — found
// live-testing vercel.com: extractor said #0070f3, UI showed mock purple.)
export const techdetect: TechDetectProvider =
  env.providerMode === "mock" ? mock : live;

