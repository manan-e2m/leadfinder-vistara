import type { AuditFn } from "./context";
import type { DetectedSignal } from "@/lib/types";
import { SERVICE_BY_FAMILY } from "@/lib/types";

const SERVICE = SERVICE_BY_FAMILY.web;

/**
 * Website audit. Signal → indication → agency pitch → E2M service.
 * Every finding carries the measurement that proves it. Plan §5.4, App. B
 */
export const auditWeb: AuditFn = async (ctx) => {
  const out: DetectedSignal[] = [];
  const { tech, speed } = ctx;

  // A site that cannot be reached at all is a finding in its own right,
  // not a gap in our data. Never fabricate around it.
  if (tech && !tech.reachable) {
    const reason = {
      empty_js_shell: "returns an empty shell to a plain fetch",
      challenge_403: "blocked by bot protection (HTTP 403)",
      timeout: "did not respond within 9 seconds",
      wrong_site: "redirects to a parked page",
      dns: "does not resolve",
      none: "",
    }[tech.failureKind];

    out.push({
      key: "web.unreachable",
      label: "Website could not be loaded",
      measurement: `Site ${reason}${tech.responseMs ? ` · ${(tech.responseMs / 1000).toFixed(1)} s` : ""}`,
      source: "Direct fetch + headless render, 9 s timeout, one retry",
      severity: "high",
      confidence: 0.9,
      family: "web",
      service: SERVICE,
      pitch: "Website rebuild",
    });
    return out;
  }
  if (!tech) return out;

  if (speed && speed.mobileScore < 50) {
    out.push({
      key: "web.poor_cwv",
      label: speed.mobileScore < 30
        ? "Mobile performance in the bottom decile"
        : "Mobile performance failing Core Web Vitals",
      measurement: `Mobile CWV ${speed.mobileScore} / 100 · LCP ${speed.lcpSeconds} s · CLS ${speed.clsScore}`,
      source: `PageSpeed Insights${speed.fieldData ? " + CrUX field data" : " (lab data only)"}`,
      severity: speed.mobileScore < 30 ? "high" : "med",
      confidence: speed.fieldData ? 1 : 0.7,
      family: "web",
      service: SERVICE,
      pitch: "Website rebuild",
      benchmark: (await ctx.benchmarkFor("mobile_cwv", speed.mobileScore)) ?? undefined,
    });
  }

  if (speed && speed.totalBytesMb > 2.5) {
    out.push({
      key: "web.heavy_page",
      label: "Homepage ships unoptimized assets",
      measurement: `${speed.totalBytesMb} MB transferred on the homepage`,
      source: "PageSpeed Insights total byte weight",
      severity: "low",
      confidence: 0.85,
      family: "web",
      service: SERVICE,
      pitch: "Performance work",
    });
  }

  if (!tech.ssl.valid) {
    const days = tech.ssl.expiresInDays;
    out.push({
      key: "web.ssl_expired",
      label: "SSL certificate expired",
      measurement: days !== null && days < 0
        ? `Expired ${Math.abs(days)} days ago · browser interstitial before the site loads`
        : "No valid certificate · browser warning on every visit",
      source: "TLS handshake",
      severity: "high",
      confidence: 1,
      family: "web",
      service: SERVICE,
      pitch: "Emergency fix + maintenance retainer",
    });
  }

  if (tech.cms === "WordPress" && tech.cmsVersion) {
    const major = Number(tech.cmsVersion.split(".")[0]);
    if (major < 6) {
      out.push({
        key: "web.outdated_cms",
        label: "WordPress two major versions behind",
        measurement: `WP ${tech.cmsVersion}${tech.themeLastUpdatedYear ? ` · theme last updated ${tech.themeLastUpdatedYear}` : ""}`,
        source: "HTTP header + HTML fingerprint",
        severity: "med",
        confidence: 0.9,
        family: "web",
        service: SERVICE,
        pitch: "Website rebuild",
      });
    }
  }

  if (tech.themeLastUpdatedYear && new Date().getFullYear() - tech.themeLastUpdatedYear >= 5) {
    out.push({
      key: "web.abandoned_theme",
      label: "Theme abandoned by its author",
      measurement: `Theme last release ${tech.themeLastUpdatedYear} · ${new Date().getFullYear() - tech.themeLastUpdatedYear} years without a security update`,
      source: "Theme fingerprint + version lookup",
      severity: "high",
      confidence: 0.8,
      family: "web",
      service: SERVICE,
      pitch: "Website rebuild",
    });
  }

  if (!tech.hasViewportMeta || tech.horizontalScrollAt390) {
    out.push({
      key: "web.not_responsive",
      label: "Layout breaks on small phones",
      measurement: [
        tech.horizontalScrollAt390 ? "horizontal scroll at 390px" : null,
        !tech.hasViewportMeta ? "no viewport meta tag" : null,
      ].filter(Boolean).join(" · "),
      source: "Headless render at a 390px viewport",
      severity: "high",
      confidence: 0.85,
      family: "web",
      service: SERVICE,
      pitch: "Responsive rebuild",
    });
  }

  if (tech.formEndpointHealthy === false) {
    out.push({
      key: "web.broken_form",
      label: "Contact form fails silently on submit",
      measurement: "POST returns a server error · the page resets with no message and no email is delivered",
      source: "Form endpoint check",
      severity: "high",
      confidence: 0.9,
      family: "web",
      service: SERVICE,
      pitch: "Emergency fix + maintenance",
    });
  }

  const noTracking =
    !tech.analytics.ga4 && !tech.analytics.metaPixel &&
    !tech.analytics.googleAds && !tech.analytics.tagManager;
  if (noTracking) {
    out.push({
      key: "web.no_analytics",
      label: "No measurement infrastructure at all",
      measurement: "No GA4 · no Meta pixel · no Google Ads tag · no tag manager",
      source: "Script detection across all templates",
      severity: "med",
      confidence: 0.95,
      family: "web",
      service: SERVICE,
      pitch: "Tracking setup",
    });
  }

  return out;
};
