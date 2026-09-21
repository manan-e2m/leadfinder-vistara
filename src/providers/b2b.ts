import { env, useLive } from "@/lib/env";
import type { B2bProvider, B2bCompany } from "./types";
import { rng, int, chance, pick, syntheticPool, domainFor, roleEmailFor } from "./fixtures";

const FIRST = ["Dana","Marcus","Priya","Tomas","Ellen","Ryan","Simone","Lourdes","Ingrid","Joel","Hana","Wilhelmina"];
const LAST  = ["Okonkwo","Whitcomb","Nandakumar","Beaulieu","Wachowski","Sedillo","Achterberg","Bettencourt","Salvatierra","Vantrease","Lindqvist","Asante"];

const mock: B2bProvider = {
  name: "b2b/mock",
  live: false,
  async search({ industry, region, limit }) {
    return syntheticPool(region, industry, limit).map<B2bCompany>((b) => {
      const r = rng(`b2b|${b.slug}`);
      const named = chance(r, 0.45);
      return {
        externalId: `mock_b2b_${b.slug}`,
        name: b.name,
        domain: domainFor(b),
        headcount: int(r, 8, 420),
        industry,
        city: b.city,
        region,
        phone: b.phone,
        email: roleEmailFor(b),
        emailIsRole: true,
        namedContact: named ? `${pick(r, FIRST)} ${pick(r, LAST)}` : null,
        hiringMarketingRole: chance(r, 0.16),
      };
    });
  },
};

/**
 * Apollo-class B2B database for regional and national ICPs. Two constraints
 * carry through from the plan: license it for this use case, and verify
 * every record before display. Role addresses are labelled as such and never
 * presented as a named person. Plan §5.3, App. A
 */
const live: B2bProvider = {
  name: "b2b/apollo",
  live: true,
  async search({ industry, region, limit }) {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_companies/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.keys.apollo,
      },
      body: JSON.stringify({
        q_organization_keyword_tags: [industry],
        organization_locations: [region],
        per_page: Math.min(limit, 100),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`apollo ${res.status}`);
    const d = (await res.json()) as { organizations?: any[] };
    return (d.organizations ?? []).map<B2bCompany>((o) => ({
      externalId: o.id,
      name: o.name,
      domain: o.primary_domain ?? null,
      headcount: o.estimated_num_employees ?? null,
      industry: o.industry ?? industry,
      city: o.city ?? null,
      region: o.state ?? region,
      phone: o.phone ?? null,
      email: null,
      emailIsRole: true,
      namedContact: null,
      hiringMarketingRole: false,
    }));
  },
};

export const b2b: B2bProvider = useLive(env.keys.apollo) ? live : mock;
