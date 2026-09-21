/**
 * Every external dependency sits behind one of these interfaces. Each has a
 * mock implementation that returns realistic, deterministic data and a live
 * implementation that calls the real API. The registry in ./index.ts picks
 * one per provider based on whether its key is present.
 *
 * Consequence: the platform runs end to end, today, with an empty .env —
 * and goes live one key at a time as budget and approvals land, with no
 * code change anywhere above this layer.
 */

export interface PlaceRecord {
  externalId: string;
  name: string;
  website: string | null;
  phone: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  reviewLatestAt: Date | null;
  businessStatus: "operational" | "permanently_closed" | "unknown";
  categories: string[];
  locationCount: number;
  /** owner responses present on reviews — feeds the AI-intake audit */
  ownerRespondsToReviews: boolean;
  /** attribution string required by the source's terms. Plan §10 */
  attribution: string;
}

export interface PlacesProvider {
  readonly name: string;
  readonly live: boolean;
  /** Candidate pool for a vertical within a radius of a metro. */
  search(args: {
    vertical: string;
    metro: string;
    radiusMiles: number;
    limit: number;
  }): Promise<PlaceRecord[]>;
  /** Is this business in the local pack for a core term? */
  localPackPresence(args: {
    term: string;
    metro: string;
    businessName: string;
  }): Promise<{ inPack: boolean; position: number | null; term: string }>;
}

export interface PageSpeedResult {
  mobileScore: number;        // 0..100
  lcpSeconds: number;
  clsScore: number;
  totalBytesMb: number;
  fieldData: boolean;         // true = CrUX field data, false = lab only
}

export interface PageSpeedProvider {
  readonly name: string;
  readonly live: boolean;
  run(url: string): Promise<PageSpeedResult | null>;
}

export interface TechProfile {
  reachable: boolean;
  /** why a fetch failed — drives the fallback ladder. Plan §6.2 */
  failureKind: "none" | "empty_js_shell" | "challenge_403" | "timeout" | "wrong_site" | "dns";
  httpStatus: number | null;
  responseMs: number;
  ssl: { valid: boolean; expiresInDays: number | null };
  cms: string | null;
  cmsVersion: string | null;
  themeLastUpdatedYear: number | null;
  storefront: "shopify" | "woocommerce" | "bigcommerce" | null;
  analytics: { ga4: boolean; metaPixel: boolean; googleAds: boolean; tagManager: boolean };
  schema: { localBusiness: boolean; product: boolean; faq: boolean; review: boolean };
  hasViewportMeta: boolean;
  horizontalScrollAt390: boolean;
  chatWidget: boolean;
  bookingWidget: boolean;
  formEndpointHealthy: boolean | null;
  blogLatestPost: Date | null;
  servicePages: { url: string; words: number }[];
  locationPages: number;
  checkoutLcpSeconds: number | null;
  reviewsApp: boolean | null;
  productCount: number | null;
  /** parsed from the site during ICP inference */
  detectedServices: string[];
  detectedVerticals: string[];
  brandPrimaryColor: string | null;
  logoUrl: string | null;
}

export interface TechDetectProvider {
  readonly name: string;
  readonly live: boolean;
  profile(url: string): Promise<TechProfile>;
}

export interface AdActivity {
  advertiserFound: boolean;
  activeAdCount: number;
  platforms: ("meta" | "google")[];
  destinationUrls: string[];
  competitorsAdvertising: number;
  promotedThemes: string[];
}

export interface AdLibraryProvider {
  readonly name: string;
  readonly live: boolean;
  lookup(args: { businessName: string; domain: string | null; metro?: string }): Promise<AdActivity>;
}

export interface GbpProfile {
  found: boolean;
  category: string | null;
  description: string | null;
  serviceArea: string | null;
  reviewCount: number;
  reviewLatestAt: Date | null;
  ownerResponseCount: number;
  lastOwnerResponseAt: Date | null;
  postCount: number;
  servicesListed: boolean;
  photoLatestAt: Date | null;
  reviewTextSamples: string[];
  businessStatus: "operational" | "permanently_closed" | "unknown";
}

export interface GbpProvider {
  readonly name: string;
  readonly live: boolean;
  lookup(args: { businessName: string; domain?: string | null }): Promise<GbpProfile>;
}

export interface B2bCompany {
  externalId: string;
  name: string;
  domain: string | null;
  headcount: number | null;
  industry: string | null;
  city: string | null;
  region: string | null;
  phone: string | null;
  /** role addresses are labelled as such, never passed off as a person */
  email: string | null;
  emailIsRole: boolean;
  namedContact: string | null;
  hiringMarketingRole: boolean;
}

export interface B2bProvider {
  readonly name: string;
  readonly live: boolean;
  search(args: { industry: string; region: string; limit: number }): Promise<B2bCompany[]>;
}

export interface VerifyResult {
  phone: { valid: boolean; lineType: string | null; reason?: string };
  email: { valid: boolean; isRole: boolean; mxOk: boolean; reason?: string };
  site: { resolves: boolean; reason?: string };
}

export interface VerifyProvider {
  readonly name: string;
  readonly live: boolean;
  check(args: {
    phone: string | null;
    email: string | null;
    website: string | null;
  }): Promise<VerifyResult>;
}

export interface LlmProvider {
  readonly name: string;
  readonly live: boolean;
  /** Strict JSON in, strict JSON out, with a token cap per run. */
  json<T>(args: {
    system: string;
    prompt: string;
    maxTokens?: number;
    fallback: T;
  }): Promise<{ value: T; origin: "llm" | "template" }>;
}

export interface CrmContact {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  tags: string[];
  /** detected gaps land as custom fields, not free text. Plan §11.1 */
  customFields: Record<string, string>;
}

export interface CrmProvider {
  readonly name: string;
  readonly live: boolean;
  push(contacts: CrmContact[]): Promise<{ ok: boolean; count: number; error?: string }>;
}

export interface EmailProvider {
  readonly name: string;
  readonly live: boolean;
  send(args: { to: string; subject: string; html: string }): Promise<{ ok: boolean; error?: string }>;
}

export interface BenchmarkProvider {
  readonly name: string;
  readonly live: boolean;
  /**
   * Benchmark a measured value against E2M's corpus of 10,000+ delivered
   * sites. Additive by design: when the corpus is unavailable this returns
   * null and the benchmark line is omitted, never invented. Plan §8.1, §15
   */
  compare(args: { metric: string; value: number }): Promise<string | null>;
}
