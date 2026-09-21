import type { AuditFn } from "./context";
import type { DetectedSignal } from "@/lib/types";
import { SERVICE_BY_FAMILY } from "@/lib/types";

const SERVICE = SERVICE_BY_FAMILY.ai;

/** AI intake and automation: missed leads after hours. Plan §5.4, App. B */
export const auditAiIntake: AuditFn = async (ctx) => {
  const out: DetectedSignal[] = [];
  const { tech, gbpProfile, business } = ctx;

  if (tech?.reachable && !tech.chatWidget && !tech.bookingWidget) {
    out.push({
      key: "ai.no_after_hours_intake",
      label: "No after-hours intake path",
      measurement: "No chat widget · no online booking · no form auto-response" +
        (business.locationCount > 1 ? ` · ${business.locationCount} locations sharing one number` : ""),
      source: "Widget and form detection",
      severity: business.locationCount > 1 ? "high" : "med",
      confidence: 0.85,
      family: "ai",
      service: SERVICE,
      pitch: "AI intake & automation",
    });
  }

  const reviews = gbpProfile?.reviewCount ?? business.reviewCount ?? 0;
  const responses = gbpProfile?.ownerResponseCount ?? (business.ownerRespondsToReviews ? 1 : 0);
  if (reviews >= 25 && responses === 0) {
    out.push({
      key: "ai.no_review_responses",
      label: "Reviews go unanswered",
      measurement: `${reviews} reviews · 0 owner responses`,
      source: "Google Business Profile owner-response presence",
      severity: reviews >= 100 ? "high" : "med",
      confidence: 0.9,
      family: "ai",
      service: SERVICE,
      pitch: "Reputation automation",
    });
  } else if (gbpProfile?.lastOwnerResponseAt) {
    const months = Math.floor((Date.now() - gbpProfile.lastOwnerResponseAt.getTime()) / (864e5 * 30.44));
    if (months >= 12) {
      out.push({
        key: "ai.review_responses_stopped",
        label: "Review responses stopped",
        measurement: `Last owner response ${gbpProfile.lastOwnerResponseAt.toLocaleString("en-US", { month: "short", year: "numeric" })} · ${months} months ago`,
        source: "Google Business Profile owner-response data",
        severity: "low",
        confidence: 0.85,
        family: "ai",
        service: SERVICE,
        pitch: "Reputation automation",
      });
    }
  }

  return out;
};
