import { places, b2b, adlibrary, type PlaceRecord } from "@/providers";
import type { Icp, RouteDecision } from "@/lib/types";
import { cacheGet, cacheSet, poolKey } from "@/lib/cache";
import { log, logFailure } from "@/lib/logger";
import type { RunBudget } from "@/lib/cost";

/**
 * Stage 3 — Sourcing. Target a candidate pool of 200–500 businesses that fit,
 * which the audits and scoring narrow to 15–25. Budget 5–15 s. Plan §5.3
 *
 * Fallbacks: too few candidates → widen the radius, then widen the category,
 * and say so on screen rather than returning nothing. Source API down →
 * alternate source, then the cached pool for this metro and vertical. App. C
 */

export interface SourceResult {
  candidates: PlaceRecord[];
  /** shown on the progress screen when we had to widen */
  widenedNote: string | null;
  fromCache: boolean;
  effectiveRadius: number;
  sourcesUsed: string[];
}

const TARGET_POOL = 340;
const MIN_POOL = 60;

export async function sourceCandidates(args: {
  icp: Icp;
  route: RouteDecision;
  budget: RunBudget;
}): Promise<SourceResult> {
  const { icp, route, budget } = args;
  const vertical = icp.targetVerticals.value || "local business";
  const metro = icp.metro;
  const sourcesUsed: string[] = [];

  // Two agencies targeting dentists in the same metro share one pool. This
  // is the biggest cost and latency saver in the whole build. Plan §9.2
  const key = poolKey(metro, vertical);
  const cached = await cacheGet<PlaceRecord[]>(key);
  if (cached?.length) {
    log("info", "source", `pool cache hit: ${cached.length} candidates for ${key}`);
    return {
      candidates: revive(cached),
      widenedNote: null,
      fromCache: true,
      effectiveRadius: icp.radiusMiles,
      sourcesUsed: ["Cached pool (metro + vertical)"],
    };
  }

  let radius = icp.radiusMiles;
  let widenedNote: string | null = null;
  let pool: PlaceRecord[] = [];

  const wantsLocal = route.routes.includes("local_service") || route.routes.includes("budget_qualified");
  const wantsB2b = route.routes.includes("regional_b2b");
  const wantsEcom = route.routes.includes("ecommerce");

  if (wantsLocal) {
    try {
      pool = await places.search({ vertical, metro, radiusMiles: radius, limit: TARGET_POOL });
      sourcesUsed.push("Google Places by category + radius");
      await budget.charge("places.nearby", Math.ceil(pool.length / 20), "places");
    } catch (e) {
      await logFailure({ stage: "source", reason: `places_failed: ${(e as Error).message}` });
    }
  }

  // Two routes both apply → run both paths and merge, deduped by domain.
  if (wantsB2b) {
    try {
      const companies = await b2b.search({
        industry: vertical,
        region: icp.geography.value || metro,
        limit: Math.floor(TARGET_POOL / 2),
      });
      sourcesUsed.push("B2B database + LinkedIn");
      await budget.charge("apollo.search", 1, "b2b");
      pool = pool.concat(
        companies.map<PlaceRecord>((c) => ({
          externalId: c.externalId,
          name: c.name,
          website: c.domain,
          phone: c.phone,
          email: c.email,
          addressLine: null,
          city: c.city,
          region: c.region,
          postalCode: null,
          lat: null, lng: null,
          rating: null, reviewCount: null, reviewLatestAt: null,
          businessStatus: "unknown",
          categories: [c.industry ?? vertical],
          locationCount: 1,
          ownerRespondsToReviews: false,
          attribution: "B2B contact database, licensed for this use case",
        }))
      );
    } catch (e) {
      await logFailure({ stage: "source", reason: `b2b_failed: ${(e as Error).message}` });
    }
  }

  if (wantsEcom && pool.length) {
    sourcesUsed.push("Storefront detection (Shopify / Woo / BigCommerce)");
  }

  // Too few candidates → widen the radius, then the category. Say so.
  if (pool.length < MIN_POOL && wantsLocal) {
    radius = Math.max(radius * 2, 50);
    try {
      pool = await places.search({ vertical, metro, radiusMiles: radius, limit: TARGET_POOL });
      widenedNote = `Expanded to ${radius} mi to find enough matches`;
      await budget.charge("places.nearby", Math.ceil(pool.length / 20), "places");
    } catch { /* fall through to category widening */ }
  }
  if (pool.length < MIN_POOL && wantsLocal) {
    const parent = vertical.split(/[,&]/)[0].trim() || "local business";
    try {
      pool = await places.search({ vertical: parent, metro, radiusMiles: radius, limit: TARGET_POOL });
      widenedNote = `Expanded to "${parent}" within ${radius} mi to find enough matches`;
      await budget.charge("places.nearby", Math.ceil(pool.length / 20), "places");
    } catch (e) {
      await logFailure({ stage: "source", reason: `widen_failed: ${(e as Error).message}` });
    }
  }

  // Ad-library sourcing is the budget-qualified path: a business already
  // running ads has proven willingness to spend.
  if (route.routes.includes("budget_qualified")) sourcesUsed.push("Ad Library + hiring signal");

  const deduped = dedupeByDomain(pool);
  if (deduped.length) await cacheSet(key, "pool", deduped);

  return {
    candidates: deduped,
    widenedNote,
    fromCache: false,
    effectiveRadius: radius,
    sourcesUsed,
  };
}

/** The agency never sees two lists. Dedupe on domain, then on name + city. */
function dedupeByDomain(rows: PlaceRecord[]): PlaceRecord[] {
  const seen = new Set<string>();
  const out: PlaceRecord[] = [];
  for (const r of rows) {
    const key = (r.website ?? `${r.name}|${r.city ?? ""}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** JSON round-trips dates to strings; restore them coming out of cache. */
function revive(rows: PlaceRecord[]): PlaceRecord[] {
  return rows.map((r) => ({
    ...r,
    reviewLatestAt: r.reviewLatestAt ? new Date(r.reviewLatestAt) : null,
  }));
}
