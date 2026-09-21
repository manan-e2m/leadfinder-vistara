import { pagespeed, techdetect, adlibrary, gbp, places, benchmark, type PlaceRecord } from "@/providers";
import { AUDITS, type AuditContext } from "../audits";
import type { DetectedSignal, Icp, RouteDecision } from "@/lib/types";
import { cacheGet, cacheSet, auditKey } from "@/lib/cache";
import { logFailure } from "@/lib/logger";
import type { RunBudget } from "@/lib/cost";
import { coreTermsFor } from "./route";

/**
 * Stage 4 — Gap audits. The product's differentiator: cheap automated checks
 * per candidate, each finding translated into the E2M service that fixes it.
 * Budget 20–45 s for the whole stage. Plan §5.4
 *
 * Fallbacks: an audit that times out for a candidate is SKIPPED and that
 * candidate's confidence drops — we never fabricate a finding. If every
 * audit fails, scoring falls back to fit-only and findings are marked
 * pending. App. C
 */

export interface AuditedCandidate {
  place: PlaceRecord;
  signals: DetectedSignal[];
  /** true when at least one audit family failed for this candidate */
  partial: boolean;
}

export interface AuditStageResult {
  audited: AuditedCandidate[];
  auditedCount: number;
  failedAudits: number;
  /** true when every audit failed and scoring must fall back to fit-only */
  allFailed: boolean;
  degradedByCost: boolean;
}

const CONCURRENCY = 8;

export async function runAudits(args: {
  candidates: PlaceRecord[];
  icp: Icp;
  route: RouteDecision;
  budget: RunBudget;
  /** narrow the pool before auditing — auditing 340 sites is wasteful */
  auditLimit?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<AuditStageResult> {
  const { icp, route, budget } = args;
  const limit = args.auditLimit ?? 120;

  // Audit the most promising slice, not the whole pool: rating, review
  // volume and having a website are cheap proxies for "worth the spend".
  const shortlist = [...args.candidates]
    .sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0))
    .slice(0, limit);

  const localPackTerms = coreTermsFor(icp, icp.metro);
  const audited: AuditedCandidate[] = [];
  let failedAudits = 0;
  let done = 0;
  let degradedByCost = false;

  for (let i = 0; i < shortlist.length; i += CONCURRENCY) {
    const batch = shortlist.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (place) => {
        try {
          const r = await auditOne({ place, icp, route, budget, localPackTerms });
          if (r.degradedByCost) degradedByCost = true;
          return r.result;
        } catch (e) {
          failedAudits++;
          await logFailure({
            stage: "audit",
            reason: (e as Error).message,
            url: place.website,
          });
          // Skip the failed audit, lower the confidence — do not fabricate.
          return { place, signals: [], partial: true } as AuditedCandidate;
        }
      })
    );
    audited.push(...results);
    done += batch.length;
    args.onProgress?.(done, shortlist.length);
  }

  const withFindings = audited.filter((a) => a.signals.length > 0).length;

  return {
    audited,
    auditedCount: done,
    failedAudits,
    allFailed: withFindings === 0 && audited.length > 0,
    degradedByCost,
  };
}

async function auditOne(args: {
  place: PlaceRecord;
  icp: Icp;
  route: RouteDecision;
  budget: RunBudget;
  localPackTerms: string[];
}): Promise<{ result: AuditedCandidate; degradedByCost: boolean }> {
  const { place, icp, route, budget } = args;
  const domain = place.website;
  let degradedByCost = false;

  // Per-business audit cache, keyed on domain + family. Two agencies
  // targeting the same metro reuse these outright. Plan §9.2
  const cacheK = domain ? auditKey(domain, route.auditFamilies.join("-")) : null;
  if (cacheK) {
    const hit = await cacheGet<DetectedSignal[]>(cacheK);
    if (hit) return { result: { place, signals: hit, partial: false }, degradedByCost };
  }

  // Only run what the route cares about — and only what the budget allows.
  const wantSpeed = route.auditFamilies.includes("web") || route.auditFamilies.includes("ppc");
  const wantAds = route.auditFamilies.includes("ppc") || route.auditFamilies.includes("ai");
  const wantGbp = route.auditFamilies.includes("seo") || route.auditFamilies.includes("ai");
  const wantPack = route.auditFamilies.includes("seo");

  const canSpend = budget.canAfford("techdetect.fetch");
  if (!canSpend) degradedByCost = true;

  const [tech, speed, ads, profile] = await Promise.all([
    domain && canSpend ? techdetect.profile(domain).catch(() => null) : Promise.resolve(null),
    domain && wantSpeed && canSpend ? pagespeed.run(domain).catch(() => null) : Promise.resolve(null),
    wantAds && canSpend ? adlibrary.lookup({ businessName: place.name, domain, metro: icp.metro }).catch(() => null) : Promise.resolve(null),
    wantGbp && canSpend ? gbp.lookup({ businessName: place.name, domain }).catch(() => null) : Promise.resolve(null),
  ]);

  if (canSpend) {
    await budget.charge("techdetect.fetch", 1, "techdetect");
    if (wantSpeed) await budget.charge("pagespeed.run", 1, "pagespeed");
    if (wantGbp) await budget.charge("gbp.lookup", 1, "gbp");
  }

  let localPack: AuditContext["localPack"] = [];
  if (wantPack && canSpend) {
    localPack = await Promise.all(
      args.localPackTerms.slice(0, 3).map((term) =>
        places
          .localPackPresence({ term, metro: icp.metro, businessName: place.name })
          .catch(() => ({ inPack: false, position: null, term }))
      )
    );
  }

  const ctx: AuditContext = {
    business: {
      name: place.name,
      domain,
      city: place.city,
      metro: icp.metro,
      locationCount: place.locationCount,
      reviewCount: place.reviewCount,
      reviewLatestAt: place.reviewLatestAt,
      ownerRespondsToReviews: place.ownerRespondsToReviews,
      place,
    },
    tech,
    speed,
    ads,
    gbpProfile: profile,
    coreTerms: args.localPackTerms,
    localPack,
    benchmarkFor: (metric, value) => benchmark.compare({ metric, value }).catch(() => null),
  };

  const families = route.auditFamilies;
  const settled = await Promise.allSettled(families.map((f) => AUDITS[f](ctx)));

  const signals: DetectedSignal[] = [];
  let partial = false;
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") signals.push(...s.value);
    else {
      partial = true;
      void logFailure({ stage: `audit:${families[i]}`, reason: s.reason?.message ?? "unknown", url: domain });
    }
  });

  // A thin or timed-out audit is marked lower confidence on screen rather
  // than presented with the same certainty as a verified finding.
  // Workflow change 06
  if (partial || !tech?.reachable) {
    for (const s of signals) s.confidence = Math.min(s.confidence, 0.55);
  }

  if (cacheK && !partial) await cacheSet(cacheK, "audit", signals);
  return { result: { place, signals, partial }, degradedByCost };
}
