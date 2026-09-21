import type { AuditFn } from "./context";
import type { DetectedSignal } from "@/lib/types";
import { SERVICE_BY_FAMILY } from "@/lib/types";

const SERVICE = SERVICE_BY_FAMILY.ppc;

/**
 * Paid media audit. Two distinct findings live here and they are opposites:
 * losing paid share (competitors bidding, prospect absent) and wasting spend
 * (ads running to a weak page, or with no tracking at all). Plan §5.4
 */
export const auditPpc: AuditFn = async (ctx) => {
  const out: DetectedSignal[] = [];
  const { ads, tech, speed } = ctx;
  if (!ads) return out;

  if (!ads.advertiserFound && ads.competitorsAdvertising >= 2) {
    out.push({
      key: "ppc.losing_share",
      label: "Competitors are bidding, they aren't",
      measurement: `${ads.competitorsAdvertising} advertisers active on core terms in this metro · prospect has no ad history`,
      source: "Google Ads Transparency Center + Meta Ad Library",
      severity: "high",
      confidence: 0.8,
      family: "ppc",
      service: SERVICE,
      pitch: "Paid media management",
    });
  }

  if (ads.advertiserFound && tech?.reachable) {
    const noPixel = !tech.analytics.metaPixel && !tech.analytics.googleAds;
    if (noPixel) {
      out.push({
        key: "ppc.untracked_spend",
        label: "Active ads with no conversion tracking",
        measurement: `${ads.activeAdCount} active ad${ads.activeAdCount === 1 ? "" : "s"} on ${ads.platforms.join(" + ")} · no pixel, no conversion tag`,
        source: "Ad Library cross-referenced with script detection",
        severity: "high",
        confidence: 0.9,
        family: "ppc",
        service: SERVICE,
        pitch: "Paid media management",
      });
    }

    const weakLanding = !tech.bookingWidget && tech.formEndpointHealthy !== true;
    const slowLanding = speed !== null && speed.mobileScore < 45;
    if (weakLanding || slowLanding) {
      out.push({
        key: "ppc.weak_landing",
        label: "Paying for traffic to a dead end",
        measurement: [
          `${ads.activeAdCount} active ad${ads.activeAdCount === 1 ? "" : "s"}`,
          weakLanding ? "destination page has no form and no booking" : null,
          slowLanding && speed ? `destination mobile CWV ${speed.mobileScore} / 100` : null,
        ].filter(Boolean).join(" · "),
        source: "Ad Library destination URL audited",
        severity: "high",
        confidence: 0.8,
        family: "ppc",
        service: SERVICE,
        pitch: "Landing page + paid media",
      });
    }
  }

  return out;
};
