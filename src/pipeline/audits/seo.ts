import type { AuditFn } from "./context";
import type { DetectedSignal } from "@/lib/types";
import { SERVICE_BY_FAMILY } from "@/lib/types";
import { monthsSince } from "./context";

const SERVICE = SERVICE_BY_FAMILY.seo;

/** Local SEO audit: invisible where customers search. Plan §5.4, App. B */
export const auditSeo: AuditFn = async (ctx) => {
  const out: DetectedSignal[] = [];
  const { tech, gbpProfile, business, localPack } = ctx;

  const missedTerms = localPack.filter((t) => !t.inPack);
  if (localPack.length && missedTerms.length === localPack.length) {
    out.push({
      key: "seo.absent_local_pack",
      label: "Not in the local pack on any core term",
      measurement: `Outside the top 3 for ${missedTerms.map((t) => `"${t.term}"`).join(", ")}`,
      source: "Places query on core service terms in the metro",
      severity: "high",
      confidence: 0.85,
      family: "seo",
      service: SERVICE,
      pitch: "Local SEO program",
    });
  }

  const reviewCount = gbpProfile?.reviewCount ?? business.reviewCount ?? 0;
  const monthsStale = monthsSince(gbpProfile?.reviewLatestAt ?? business.reviewLatestAt);
  if (reviewCount < 20 || (monthsStale !== null && monthsStale >= 6)) {
    out.push({
      key: "seo.stale_reviews",
      label: reviewCount < 20 ? "Review volume well below the category" : "Google reviews have gone cold",
      measurement: [
        `${reviewCount} review${reviewCount === 1 ? "" : "s"}`,
        monthsStale !== null ? `newest ${monthsStale} month${monthsStale === 1 ? "" : "s"} old` : null,
      ].filter(Boolean).join(" · "),
      source: "Google Places review count and latest review date",
      severity: reviewCount < 12 && (monthsStale ?? 0) >= 6 ? "high" : "med",
      confidence: 0.95,
      family: "seo",
      service: SERVICE,
      pitch: "Local SEO retainer",
      benchmark: (await ctx.benchmarkFor("review_count", reviewCount)) ?? undefined,
    });
  }

  if (tech && !tech.schema.localBusiness) {
    out.push({
      key: "seo.no_schema",
      label: "No structured data on any page",
      measurement: "No LocalBusiness, Dentist or Review schema · no NAP markup",
      source: "Structured data parse, all templates",
      severity: "med",
      confidence: 0.9,
      family: "seo",
      service: SERVICE,
      pitch: "Local SEO program",
    });
  }

  if (gbpProfile?.found && gbpProfile.postCount === 0 && !gbpProfile.servicesListed) {
    out.push({
      key: "seo.bare_gbp",
      label: "Google Business Profile is bare",
      measurement: "No posts · no services listed" +
        (gbpProfile.photoLatestAt ? ` · no new photos since ${gbpProfile.photoLatestAt.getFullYear()}` : ""),
      source: "Google Business Profile public data",
      severity: "med",
      confidence: 0.9,
      family: "seo",
      service: SERVICE,
      pitch: "Local SEO program",
    });
  }

  if (business.locationCount > 1 && tech && tech.locationPages < business.locationCount) {
    const missing = business.locationCount - tech.locationPages;
    out.push({
      key: "seo.missing_location_pages",
      label: `${missing} of ${business.locationCount} locations have no page`,
      measurement: `${business.locationCount} listings · ${tech.locationPages} location page${tech.locationPages === 1 ? "" : "s"} on the site`,
      source: "Places listings compared against the sitemap",
      severity: "high",
      confidence: 0.8,
      family: "seo",
      service: SERVICE,
      pitch: "Local SEO program",
    });
  }

  return out;
};
