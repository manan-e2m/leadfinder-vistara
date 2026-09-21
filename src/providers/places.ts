import { env, useLive } from "@/lib/env";
import type { PlacesProvider, PlaceRecord } from "./types";
import { syntheticPool, domainFor, rng, chance, int, metroKey, verticalKey } from "./fixtures";

const ATTRIBUTION = "Business data from Google — attribution required by the Places terms. Plan §10";

const mock: PlacesProvider = {
  name: "places/mock",
  live: false,
  async search({ vertical, metro, radiusMiles, limit }) {
    const pool = syntheticPool(metro, vertical, limit);
    return pool.map<PlaceRecord>((b) => {
      const r = rng(`place|${b.slug}`);
      return {
        externalId: `mock_place_${b.slug}${b.sourceMismatch ? "__mismatch" : ""}`,
        name: b.name,
        website: b.parkedDomain ? `parked-${b.slug.slice(0, 18)}.com` : domainFor(b),
        phone: b.phone,
        addressLine: b.street,
        city: b.city,
        region: metroKey(metro) === "austin" ? "TX" : metroKey(metro) === "denver" ? "CO" : "CA",
        postalCode: String(int(r, 90001, 92199)),
        lat: 32.7 + r() * 0.6,
        lng: -117.3 + r() * 0.6,
        rating: b.rating,
        reviewCount: b.reviewCount,
        reviewLatestAt: new Date(Date.now() - b.reviewAgeDays * 864e5),
        businessStatus: b.closed ? "permanently_closed" : "operational",
        categories: [verticalKey(vertical)],
        locationCount: b.locationCount,
        ownerRespondsToReviews: b.ownerResponds,
        attribution: ATTRIBUTION,
      };
    }).filter((_, i) => i < limit);
  },
  async localPackPresence({ term, businessName }) {
    const r = rng(`pack|${businessName}|${term}`);
    const inPack = chance(r, 0.34);
    return { inPack, position: inPack ? int(r, 1, 3) : null, term };
  },
};

/**
 * Google Places. Best single source for the local-service verticals that make
 * up most of the Vistara room. Caching rules for place details apply — the
 * pipeline caches at the pool level in src/lib/cache.ts. Plan App. A
 */
const live: PlacesProvider = {
  name: "places/google",
  live: true,
  async search({ vertical, metro, radiusMiles, limit }) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.keys.places,
        "X-Goog-FieldMask": [
          "places.id","places.displayName","places.websiteUri","places.nationalPhoneNumber",
          "places.formattedAddress","places.location","places.rating","places.userRatingCount",
          "places.businessStatus","places.types",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery: `${vertical} in ${metro}`,
        maxResultCount: Math.min(limit, 20),
        locationBias: { circle: { radius: radiusMiles * 1609 } },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`places ${res.status}`);
    const data = (await res.json()) as { places?: any[] };
    return (data.places ?? []).map<PlaceRecord>((p) => ({
      externalId: p.id,
      name: p.displayName?.text ?? "Unknown",
      website: p.websiteUri ? new URL(p.websiteUri).hostname.replace(/^www\./, "") : null,
      phone: p.nationalPhoneNumber ?? null,
      addressLine: p.formattedAddress ?? null,
      city: null, region: null, postalCode: null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? null,
      reviewLatestAt: null,
      businessStatus:
        p.businessStatus === "OPERATIONAL" ? "operational"
        : p.businessStatus === "CLOSED_PERMANENTLY" ? "permanently_closed"
        : "unknown",
      categories: p.types ?? [],
      locationCount: 1,
      ownerRespondsToReviews: false,
      attribution: ATTRIBUTION,
    }));
  },
  async localPackPresence({ term, metro, businessName }) {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.keys.places,
        "X-Goog-FieldMask": "places.displayName",
      },
      body: JSON.stringify({ textQuery: `${term} ${metro}`, maxResultCount: 3 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`places pack ${res.status}`);
    const data = (await res.json()) as { places?: { displayName?: { text?: string } }[] };
    const idx = (data.places ?? []).findIndex(
      (p) => (p.displayName?.text ?? "").toLowerCase() === businessName.toLowerCase()
    );
    return { inPack: idx >= 0, position: idx >= 0 ? idx + 1 : null, term };
  },
};

export const places: PlacesProvider = useLive(env.keys.places) ? live : mock;
