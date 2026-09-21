/**
 * Deterministic synthetic data for the mock providers.
 *
 * Two rules govern everything here:
 *   1. Deterministic. The same domain + metro + vertical always produces the
 *      same businesses, so a demo is repeatable and a screenshot stays true.
 *   2. Obviously synthetic. Names are invented and every phone number is in
 *      the 555 reserved range. Nothing here can be mistaken for a real
 *      business — that matters, because one fabricated business shown to a
 *      room of agency owners ends the product's credibility. Plan §1
 */

/** xmur3 + mulberry32: small, fast, seeded from a string. */
export function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
export const int = (r: () => number, lo: number, hi: number) => Math.floor(lo + r() * (hi - lo + 1));
export const chance = (r: () => number, p: number) => r() < p;

const PREFIX = [
  "Seabright","Canyon Glow","Bayline","Pacific","Mission Hills","La Jolla","Harbor View",
  "Coronado","Del Mar","Solana","Encinitas","North Park","Point Loma","Chula Vista",
  "Hillcrest","Rancho Bernardo","Torrey","Kearny Mesa","Old Town","Oceanside","Carmel Valley",
  "Sunset Cliffs","Balboa","Liberty Station","Mira Mesa","Poway","Escondido","Vista Ridge",
  "Northgate","Riverbend","Stonecrest","Fairhaven","Brightwater","Cedar Park","Lakeview",
  "Summit","Ironwood","Willowbrook","Copperfield","Maple Grove",
];

const SUFFIX_BY_VERTICAL: Record<string, string[]> = {
  dental: ["Dental Group","Family Dentistry","Dental Arts","Smile Studio","Dental Care","Dental Loft","Orthodontics","Orthodontic Studio","Periodontics","Cosmetic Dentistry"],
  medspa: ["MedSpa","Aesthetics Group","Skin & Laser","Med Spa Collective","Aesthetic Studio","Skin Clinic","Wellness & Aesthetics"],
  hvac: ["Heating & Air","HVAC Services","Climate Control","Air Solutions","Mechanical"],
  legal: ["Law Group","Legal Partners","Law Offices","Injury Attorneys","Family Law"],
  restaurant: ["Kitchen","Bistro","Taproom","Grill House","Cantina"],
  ecommerce: ["Supply Co.","Goods","Collective","Provisions","Apparel Co."],
  default: ["Group","Partners","Studio","Collective","Services","Co."],
};

const STREETS = ["Rosecrans St","Garnet Ave","Prospect St","Fifth Ave","Camino Del Rio","Palm Ave","Orange Ave","Grand Ave","Convoy St","Broadway"];

export const CITIES_BY_METRO: Record<string, string[]> = {
  "san-diego": ["San Diego","La Jolla","Chula Vista","Coronado","Del Mar","Encinitas","Poway","Oceanside","Solana Beach","Carlsbad"],
  austin: ["Austin","Round Rock","Cedar Park","Georgetown","Pflugerville","Leander","Buda","Kyle"],
  denver: ["Denver","Aurora","Lakewood","Littleton","Boulder","Arvada","Westminster"],
  phoenix: ["Phoenix","Scottsdale","Tempe","Mesa","Chandler","Gilbert","Glendale"],
  default: ["Northgate","Riverbend","Fairhaven","Stonecrest","Lakeview","Summit"],
};

export function verticalKey(vertical: string): string {
  const v = vertical.toLowerCase();
  if (/dent|ortho|perio|smile/.test(v)) return "dental";
  if (/med.?spa|aesthet|derm|skin|laser|wellness/.test(v)) return "medspa";
  if (/hvac|heating|plumb|air|roof/.test(v)) return "hvac";
  if (/law|legal|attorney|injury/.test(v)) return "legal";
  if (/restaurant|cafe|food|bar|dining/.test(v)) return "restaurant";
  if (/ecom|shop|store|retail|brand|dtc/.test(v)) return "ecommerce";
  return "default";
}

export function metroKey(metro: string): string {
  const m = (metro || "").toLowerCase();
  for (const k of Object.keys(CITIES_BY_METRO)) if (k !== "default" && m.includes(k.replace("-", " "))) return k;
  if (m.includes("san diego")) return "san-diego";
  return "default";
}

export interface SyntheticBusiness {
  seedIndex: number;
  name: string;
  slug: string;
  city: string;
  street: string;
  phone: string;
  rating: number;
  reviewCount: number;
  reviewAgeDays: number;
  ownerResponds: boolean;
  locationCount: number;
  hasWebsite: boolean;
  closed: boolean;
  /** disagreement between sources — trips the two-source agreement check */
  sourceMismatch: boolean;
  disconnectedPhone: boolean;
  parkedDomain: boolean;
}

/**
 * The candidate pool for a metro + vertical. A deliberate ~8% of the pool is
 * built to fail verification — closed businesses, disconnected numbers,
 * parked domains, cross-source name mismatches — because the verification
 * stage has to be exercised on every run, not just in tests. Plan §9.4
 */
export function syntheticPool(metro: string, vertical: string, count: number): SyntheticBusiness[] {
  const mk = metroKey(metro);
  const vk = verticalKey(vertical);
  const cities = CITIES_BY_METRO[mk] ?? CITIES_BY_METRO.default;
  const suffixes = SUFFIX_BY_VERTICAL[vk] ?? SUFFIX_BY_VERTICAL.default;
  const out: SyntheticBusiness[] = [];
  const seen = new Set<string>();

  for (let i = 0; out.length < count && i < count * 4; i++) {
    const r = rng(`${mk}|${vk}|${i}`);
    const name = `${pick(r, PREFIX)} ${pick(r, suffixes)}`;
    if (seen.has(name)) continue;
    seen.add(name);

    const closed = chance(r, 0.025);
    const disconnectedPhone = !closed && chance(r, 0.025);
    const parkedDomain = !closed && !disconnectedPhone && chance(r, 0.018);
    const sourceMismatch = !closed && !disconnectedPhone && !parkedDomain && chance(r, 0.018);

    out.push({
      seedIndex: i,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
      city: pick(r, cities),
      street: `${int(r, 100, 9800)} ${pick(r, STREETS)}`,
      // 555-01xx is the reserved fictional range. Never a routable number.
      phone: `(${pick(r, ["619", "858", "760", "512", "303", "480"])}) 555-0${String(int(r, 100, 199))}`,
      rating: Number((3.4 + r() * 1.6).toFixed(1)),
      reviewCount: chance(r, 0.3) ? int(r, 2, 24) : int(r, 25, 320),
      reviewAgeDays: chance(r, 0.35) ? int(r, 200, 680) : int(r, 1, 90),
      ownerResponds: chance(r, 0.4),
      locationCount: chance(r, 0.18) ? int(r, 2, 4) : 1,
      hasWebsite: !chance(r, 0.04),
      closed,
      sourceMismatch,
      disconnectedPhone,
      parkedDomain,
    });
  }
  return out;
}

export function domainFor(b: SyntheticBusiness): string | null {
  return b.hasWebsite ? `${b.slug.slice(0, 26)}.com` : null;
}

export function roleEmailFor(b: SyntheticBusiness): string | null {
  const d = domainFor(b);
  if (!d) return null;
  const r = rng(`email|${b.slug}`);
  return `${pick(r, ["info", "hello", "office", "frontdesk", "reception", "team", "contact"])}@${d}`;
}
