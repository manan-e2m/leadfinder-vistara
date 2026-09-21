import type { Icp, RouteDecision, RouteKind, AuditFamily } from "@/lib/types";
import { CONFIDENCE_THRESHOLD } from "@/lib/types";

/**
 * The fork, immediately after ICP confirm.
 *
 * Route BEFORE you audit, not after. Running every audit type on every
 * business wastes the time budget and produces findings nobody asked about.
 * The confirmed card's services and target verticals pick the route — not a
 * manual toggle the agency has to learn. This fork is invisible to the
 * agency and it is the difference between a demo that feels specific and one
 * that feels generic. Workflow doc, "Route before you audit".
 */

const AUDITS_BY_ROUTE: Record<RouteKind, AuditFamily[]> = {
  local_service: ["web", "seo", "ai"],
  regional_b2b: ["web", "content", "ppc"],
  ecommerce: ["ecommerce", "web", "ppc"],
  budget_qualified: ["ppc", "ai", "web"],
};

const LOCAL_RE = /dent|ortho|perio|med.?spa|aesthet|hvac|plumb|roof|law|attorney|clinic|salon|restaurant|local|home service|healthcare/i;
const ECOM_RE = /ecom|shopify|woo|store|retail|dtc|brand|product/i;
const B2B_RE = /b2b|saas|software|manufactur|enterprise|professional service|national|regional/i;

export function decideRoute(icp: Icp): RouteDecision {
  const vertical = icp.targetVerticals.value;
  const services = icp.servicesOffered.value;
  const geo = icp.geography.value;
  const haystack = `${vertical} ${geo}`;

  const routes = new Set<RouteKind>();

  if (LOCAL_RE.test(haystack)) routes.add("local_service");
  if (ECOM_RE.test(haystack) || /ecommerce/i.test(services)) routes.add("ecommerce");
  if (B2B_RE.test(haystack)) routes.add("regional_b2b");

  // Budget-qualified is additive rather than exclusive: an agency selling
  // paid media wants businesses with proven willingness to spend, whatever
  // the vertical. A business running ads has budget and intent, the two
  // hardest things to qualify.
  if (/paid|ppc|ads|performance/i.test(services)) routes.add("budget_qualified");

  // Vertical confidence is low → default to the local-service route, which
  // is cheapest and fastest to populate, and retry a better vertical match
  // in the background. Never block on it.
  const defaulted = routes.size === 0 || icp.targetVerticals.confidence < CONFIDENCE_THRESHOLD;
  if (routes.size === 0) routes.add("local_service");

  const list = [...routes];
  const primary = list[0];

  // Two routes both apply → run both sourcing paths and merge into one
  // shortlist, deduped by domain. The agency never sees two lists.
  const auditFamilies = [...new Set(list.flatMap((r) => AUDITS_BY_ROUTE[r]))];

  return {
    routes: list,
    primary,
    auditFamilies,
    reason: defaulted
      ? `Vertical confidence ${(icp.targetVerticals.confidence * 100).toFixed(0)}%, defaulted to the local-service route; retrying a better match in the background`
      : `Confirmed card selected ${list.join(" + ")} from vertical "${vertical || "unspecified"}" and services "${services || "unspecified"}"`,
    defaulted,
  };
}

/** Core service terms used for the local-pack check, per route + vertical. */
export function coreTermsFor(icp: Icp, metro: string): string[] {
  const v = icp.targetVerticals.value.toLowerCase();
  const base =
    /dent|ortho|smile/.test(v) ? ["cosmetic dentist", "invisalign", "dentist near me"]
    : /med.?spa|aesthet|skin|laser/.test(v) ? ["med spa", "botox", "laser hair removal"]
    : /hvac|heating|air/.test(v) ? ["ac repair", "hvac service", "furnace repair"]
    : /law|attorney/.test(v) ? ["personal injury lawyer", "family law attorney"]
    : ["best " + (v.split(/[,&]/)[0].trim() || "local business")];
  return base.map((t) => `${t} ${metro}`.trim().toLowerCase());
}
