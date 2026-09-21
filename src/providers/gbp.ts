import { env, useLive } from "@/lib/env";
import type { GbpProvider, GbpProfile } from "./types";
import { rng, int, chance, pick } from "./fixtures";

/**
 * Google Business Profile. Used twice: to infer the agency's own ICP, and to
 * read a prospect's review recency and response behaviour. Review text is a
 * strong service descriptor — clients describe the real service in plain
 * language, which is often better than the agency's own copy. Plan App. A
 */

const REVIEW_SNIPPETS = [
  "They rebuilt our website and our phone started ringing again.",
  "Handles all our Google Ads and monthly reporting.",
  "Redesigned the site and set up the booking system.",
  "Our local rankings went up within a few months.",
  "They write all our blog content and manage social.",
  "Fixed our Shopify store and the checkout issues we had.",
];

const mock: GbpProvider = {
  name: "gbp/mock",
  live: false,
  async lookup({ businessName }) {
    const r = rng(`gbp|${businessName}`);
    const found = chance(r, 0.9);
    if (!found) {
      return {
        found: false, category: null, description: null, serviceArea: null,
        reviewCount: 0, reviewLatestAt: null, ownerResponseCount: 0,
        lastOwnerResponseAt: null, postCount: 0, servicesListed: false,
        photoLatestAt: null, reviewTextSamples: [], businessStatus: "unknown",
      };
    }
    const reviewCount = int(r, 3, 240);
    const responds = chance(r, 0.4);
    return {
      found: true,
      category: pick(r, ["Marketing agency","Website designer","Dentist","Medical spa","Advertising agency"]),
      description: "Independent agency serving local businesses.",
      serviceArea: pick(r, ["San Diego County","Austin metro","Denver metro","Statewide"]),
      reviewCount,
      reviewLatestAt: new Date(Date.now() - int(r, 1, 500) * 864e5),
      ownerResponseCount: responds ? int(r, 1, reviewCount) : 0,
      lastOwnerResponseAt: responds ? new Date(Date.now() - int(r, 5, 700) * 864e5) : null,
      postCount: chance(r, 0.45) ? int(r, 1, 30) : 0,
      servicesListed: chance(r, 0.5),
      photoLatestAt: new Date(Date.now() - int(r, 30, 1200) * 864e5),
      reviewTextSamples: Array.from({ length: int(r, 2, 4) }, () => pick(r, REVIEW_SNIPPETS)),
      businessStatus: "operational",
    };
  },
};

/**
 * Live GBP data comes through the Places API rather than a separate
 * endpoint; this adapter narrows those fields to the shape the pipeline
 * wants. Review text sampling requires Place Details.
 */
const live: GbpProvider = {
  name: "gbp/places",
  live: true,
  async lookup({ businessName }) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.keys.places,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.businessStatus,places.reviews,places.editorialSummary",
      },
      body: JSON.stringify({ textQuery: businessName, maxResultCount: 1 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`gbp ${res.status}`);
    const p = ((await res.json()) as any).places?.[0];
    if (!p) {
      return {
        found: false, category: null, description: null, serviceArea: null,
        reviewCount: 0, reviewLatestAt: null, ownerResponseCount: 0,
        lastOwnerResponseAt: null, postCount: 0, servicesListed: false,
        photoLatestAt: null, reviewTextSamples: [], businessStatus: "unknown",
      };
    }
    const reviews: any[] = p.reviews ?? [];
    return {
      found: true,
      category: p.primaryTypeDisplayName?.text ?? null,
      description: p.editorialSummary?.text ?? null,
      serviceArea: null,
      reviewCount: p.userRatingCount ?? 0,
      reviewLatestAt: reviews[0]?.publishTime ? new Date(reviews[0].publishTime) : null,
      ownerResponseCount: reviews.filter((r) => r.authorAttribution?.isOwner).length,
      lastOwnerResponseAt: null,
      postCount: 0,
      servicesListed: false,
      photoLatestAt: null,
      reviewTextSamples: reviews.slice(0, 4).map((r) => r.text?.text ?? "").filter(Boolean),
      businessStatus:
        p.businessStatus === "OPERATIONAL" ? "operational"
        : p.businessStatus === "CLOSED_PERMANENTLY" ? "permanently_closed"
        : "unknown",
    };
  },
};

export const gbp: GbpProvider = useLive(env.keys.places) ? live : mock;
