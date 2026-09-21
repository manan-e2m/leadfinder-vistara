import type { AuditFn } from "./context";
import type { DetectedSignal } from "@/lib/types";
import { SERVICE_BY_FAMILY } from "@/lib/types";
import { monthsSince } from "./context";

const SERVICE = SERVICE_BY_FAMILY.content;

/** Content audit: no organic content engine. Plan §5.4, App. B */
export const auditContent: AuditFn = async (ctx) => {
  const out: DetectedSignal[] = [];
  const { tech } = ctx;
  if (!tech?.reachable) return out;

  const months = monthsSince(tech.blogLatestPost);
  if (months === null || months >= 12) {
    out.push({
      key: "content.stale_blog",
      label: "Content engine has stopped",
      measurement: tech.blogLatestPost
        ? `Latest post ${tech.blogLatestPost.toLocaleString("en-US", { month: "short", year: "numeric" })} · ${months} months ago`
        : "No blog or article section found",
      source: "Sitemap last-modified + page inventory",
      severity: months !== null && months >= 24 ? "high" : "med",
      confidence: 0.85,
      family: "content",
      service: SERVICE,
      pitch: "Content program",
    });
  }

  const thin = tech.servicePages.filter((p) => p.words < 300);
  if (thin.length >= 2) {
    const avg = Math.round(thin.reduce((a, p) => a + p.words, 0) / thin.length);
    out.push({
      key: "content.thin_pages",
      label: "Service pages are thin",
      measurement: `${thin.length} of ${tech.servicePages.length} service pages under 300 words · average ${avg}`,
      source: "Word count and heading inventory",
      severity: avg < 200 ? "high" : "med",
      confidence: 0.9,
      family: "content",
      service: SERVICE,
      pitch: "Content program",
      benchmark: (await ctx.benchmarkFor("service_page_words", avg)) ?? undefined,
    });
  }

  if (!tech.schema.faq && thin.length >= 1) {
    out.push({
      key: "content.no_faq",
      label: "No FAQ or patient-education content",
      measurement: "No FAQPage schema and no question-led content anywhere on the site",
      source: "Structured data parse + page inventory",
      severity: "low",
      confidence: 0.75,
      family: "content",
      service: SERVICE,
      pitch: "Content program",
    });
  }

  return out;
};
