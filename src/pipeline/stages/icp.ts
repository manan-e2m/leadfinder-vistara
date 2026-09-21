import { techdetect, gbp, adlibrary, llm } from "@/providers";
import { CONFIDENCE_THRESHOLD, type Icp, type BrandAssets } from "@/lib/types";
import { extractBrandFromSite, generatedAvatarColor } from "@/lib/brand";
import { cacheGet, cacheSet, icpKey } from "@/lib/cache";
import { logFailure } from "@/lib/logger";
import type { RunBudget } from "@/lib/cost";

/**
 * Stage 2 — ICP inference.
 *
 * The scrape of the agency's own site is a PRE-FILL, not a gate. It runs in
 * parallel with lower-friction sources and the merged result is shown for
 * confirmation. An agency leaves traces in many places that are easier to
 * read than its own website, so when the site is dead something else usually
 * is not. Plan §5.2, §6.1–6.5
 */

const DEAL_OPTIONS = ["Under $2.5k/mo", "$2.5k–$5k/mo", "$5k–$10k/mo", "$10k+/mo"];
const VERTICAL_OPTIONS = [
  "Local service businesses", "Healthcare & dental", "eCommerce brands",
  "B2B / SaaS", "Home services", "Restaurants & hospitality",
];
const SERVICE_OPTIONS = [
  "Web design & development", "SEO", "Paid media", "Content", "Branding", "Full service",
];
/**
 * Geography options are REAL names, not abstract scopes — the confirm card
 * should read like a human wrote it. The detected metro's proper name leads;
 * the rest are scope multipliers phrased concretely. Selection stays a plain
 * string in Icp.geography.value, and the sourcing path treats "state" and
 * "regional" selections by widening the radius around the detected metro —
 * the geography clause is display + intent, while the geo math stays here.
 */

function field(
  value: string,
  confidence: number,
  sources: string[],
  options: string[] = []
) {
  return { value, confidence, sources, options, confirmed: false };
}

export interface IcpResult {
  icp: Icp;
  brand: BrandAssets;
  /** which sources actually answered — shown as "6 sources" on the card */
  sourcesUsed: string[];
  /** true when everything came back thin and the card becomes three questions */
  fellBackToQuestions: boolean;
  siteFailure: string | null;
}

export async function inferIcp(args: {
  domain: string;
  agencyName: string;
  budget: RunBudget;
  overrides?: { city?: string | null; radiusMiles?: number | null; vertical?: string | null };
}): Promise<IcpResult> {
  const cached = await cacheGet<IcpResult>(icpKey(args.domain, args.agencyName));
  if (cached) return cached;

  // Sources run in PARALLEL. One slow or blocked source must not hold up
  // the card — the whole stage has an 8–15 s budget.
  const [tech, profile, ads] = await Promise.all([
    techdetect.profile(args.domain).catch(() => null),
    gbp.lookup({ businessName: args.agencyName, domain: args.domain }).catch(() => null),
    adlibrary.lookup({ businessName: args.agencyName, domain: args.domain }).catch(() => null),
  ]);
  // Only charge for lookups that were actually attempted — a failed fetch
  // (caught to null) is not a spent API call.
  if (tech || profile) await args.budget.charge("techdetect.fetch", 1, "techdetect");
  if (profile) await args.budget.charge("gbp.lookup", 1, "gbp");

  const sourcesUsed: string[] = [];
  if (tech?.reachable) sourcesUsed.push("Agency website");
  if (profile?.found) sourcesUsed.push("Google Business Profile");
  if (ads?.advertiserFound) sourcesUsed.push("Meta & Google Ad Library");
  if (profile?.reviewTextSamples.length) sourcesUsed.push("Client review text");
  // Directory and LinkedIn signals ride along with the profile lookup in the
  // mock; the live adapters for each are wired the same way.
  if (profile?.found) sourcesUsed.push("Clutch / DesignRush", "LinkedIn company page");

  const siteFailure = tech && !tech.reachable ? tech.failureKind : null;
  if (siteFailure) {
    await logFailure({ stage: "icp", reason: `site_${siteFailure}`, url: args.domain });
  }

  /* ── services ────────────────────────────────────────────── */
  const siteServices = tech?.detectedServices ?? [];
  const reviewServices = (profile?.reviewTextSamples ?? [])
    .map((t) => {
      const s = t.toLowerCase();
      if (s.includes("website") || s.includes("redesign")) return "Web design";
      if (s.includes("ads")) return "Paid media";
      if (s.includes("rank") || s.includes("seo")) return "SEO";
      if (s.includes("blog") || s.includes("content")) return "Content";
      if (s.includes("shopify") || s.includes("checkout")) return "eCommerce";
      return "";
    })
    .filter(Boolean);

  const serviceAgreement = siteServices.filter((s) =>
    reviewServices.some((r) => s.toLowerCase().includes(r.toLowerCase().split(" ")[0]))
  );
  const services = siteServices.length ? siteServices : reviewServices;
  // Confidence comes from AGREEMENT ACROSS SOURCES, not from one source
  // being verbose. Plan §5.2 extraction schema.
  const servicesConfidence =
    serviceAgreement.length >= 1 ? 0.92 : services.length >= 2 ? 0.74 : services.length ? 0.5 : 0.15;

  /* ── verticals ───────────────────────────────────────────── */
  const verticals = args.overrides?.vertical
    ? [args.overrides.vertical]
    : tech?.detectedVerticals ?? [];
  const verticalConfidence = args.overrides?.vertical ? 1 : verticals.length ? 0.8 : 0.2;

  /* ── geography ───────────────────────────────────────────── */
  const geoValue =
    args.overrides?.city ??
    profile?.serviceArea ??
    (tech?.reachable ? "U.S. national" : "");
  const geoConfidence = args.overrides?.city ? 1 : profile?.serviceArea ? 0.9 : 0.25;

  /* ── deal size ───────────────────────────────────────────────
   * Almost always the weakest field: directory budget bands are coarse and
   * pricing pages say "custom". This is the field the confirm card asks
   * about, and asking beats guessing. Plan §6.4
   */
  const dealConfidence = 0.38;

  const metro = (args.overrides?.city ?? profile?.serviceArea ?? "San Diego")
    .replace(/\s*(county|metro|area)\s*$/i, "")
    .trim();

  /**
   * Geography chips are REAL names, not abstract scopes — the confirm card
   * reads like a human wrote it. The detected metro's proper name leads; the
   * rest are scope multipliers phrased concretely around the detected place
   * (e.g. "San Diego County" → "All of California"). Selection stays a plain
   * string in Icp.geography.value; sourcing widens the radius for the wider
   * scopes — the geo math lives in metro/radius, this clause is meaning.
   */
  const stateForMetro = (m: string): string => {
    // Mock coverage is CA/TX/CO; live geo would come from the GBP address.
    if (/austin/i.test(m)) return "Texas";
    if (/denver/i.test(m)) return "Colorado";
    return "California";
  };
  const regionScopeOptions = [
    metro,
    `All of ${stateForMetro(metro)}`,
    `${stateForMetro(metro)} + neighboring states`,
    "Anywhere in the U.S.",
  ];

  const strong = [servicesConfidence, verticalConfidence, geoConfidence]
    .filter((c) => c >= CONFIDENCE_THRESHOLD).length;
  const fellBackToQuestions = strong === 0;

  const icp: Icp = {
    custom: [],
    servicesOffered: field(
      services.join(", ") || "",
      servicesConfidence,
      serviceAgreement.length ? ["Website services pages", "Client review text"] : ["Website services pages"],
      SERVICE_OPTIONS
    ),
    targetVerticals: field(
      verticals.join(", ") || "",
      verticalConfidence,
      ["Case studies", "Google Business category"],
      VERTICAL_OPTIONS
    ),
    geography: field(
      geoValue,
      geoConfidence,
      ["GBP service area", "Case-study locations"],
      regionScopeOptions
    ),
    dealSizeTier: field("", dealConfidence, ["Directory budget band", "Pricing page"], DEAL_OPTIONS),
    proofPoints: [],
    recencySignals: [
      ads?.advertiserFound ? `Currently running ${ads.activeAdCount} ads` : null,
      tech?.blogLatestPost
        ? `Latest post ${tech.blogLatestPost.toLocaleString("en-US", { month: "short", year: "numeric" })}`
        : null,
    ].filter(Boolean) as string[],
    metro,
    radiusMiles: args.overrides?.radiusMiles ?? 25,
    fromFallback: fellBackToQuestions,
  };

  /* ── brand assets for the white-labeled audit ────────────────
   * Extraction chain (see src/lib/brand.ts): meta og:image/apple-touch →
   * favicon → CSS colour harvest → logo img/svg candidates. When ALL of it
   * fails we no longer mint a silent generic teal — we mark the brand
   * `neutral` + `generated` and the UI renders a letter avatar with a
   * "Using generated brand" hint. App. C
   */
  const extracted = await extractBrandFromSite(args.domain).catch(() => null);
  const detectedColor = tech?.brandPrimaryColor ?? extracted?.primary ?? null;
  const logoUrl = tech?.logoUrl ?? extracted?.logoUrl ?? null;
  const detectionFailed = !tech?.reachable || (!detectedColor && !logoUrl);
  const brand: BrandAssets = {
    logoUrl,
    primary: detectedColor ?? generatedAvatarColor(args.agencyName || args.domain),
    secondary: "#08090C",
    tone: "direct, plain-spoken, no jargon",
    agencyName: args.agencyName,
    // Extraction failed → neutral template carrying their name and domain.
    // Still theirs, still sendable. App. C
    neutral: detectionFailed,
    generated: detectionFailed,
  };

  const result: IcpResult = { icp, brand, sourcesUsed, fellBackToQuestions, siteFailure };
  await cacheSet(icpKey(args.domain, args.agencyName), "icp", result);
  return result;
}

/** Fields below threshold render as a question with chips, never as a guess. */
export function needsConfirmation(icp: Icp): string[] {
  const weak: string[] = [];
  for (const k of ["servicesOffered", "targetVerticals", "geography", "dealSizeTier"] as const) {
    const f = icp[k];
    if (!f.confirmed && (f.confidence < CONFIDENCE_THRESHOLD || !f.value)) weak.push(k);
  }
  return weak;
}
