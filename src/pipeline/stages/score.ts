import { SCORE_WEIGHTS, type Icp, type ScoreBreakdown, type DetectedSignal } from "@/lib/types";
import type { VerifiedCandidate } from "./verify";

/**
 * Stage 6 — Scoring.
 *
 *   Score = Fit × Pain × Ability to pay × Reachability
 *
 * Each component is shown to the attendee. Transparency is what makes a room
 * of skeptics trust the ranking instead of arguing with it — agency owners
 * have been sold garbage lists their whole careers, and showing the work
 * beats claiming accuracy.
 *
 * Weights (30 / 30 / 25 / 15) are a STARTING POINT and should be tuned
 * during partner testing in weeks 10–13 against what agency owners actually
 * click and export. Plan §5.5, Workflow changes 02–03
 */

export interface ScoredLead {
  candidate: VerifiedCandidate;
  breakdown: ScoreBreakdown;
  headlineGap: string;
  tagLabel: string;
  benchmark: string | null;
}

export function scoreAll(args: {
  candidates: VerifiedCandidate[];
  icp: Icp;
  /** every audit failed → rank on fit alone and mark findings pending */
  fitOnly: boolean;
}): ScoredLead[] {
  const scored = args.candidates.map((c) => scoreOne(c, args.icp, args.fitOnly));
  return scored.sort((a, b) => b.breakdown.total - a.breakdown.total);
}

function scoreOne(c: VerifiedCandidate, icp: Icp, fitOnly: boolean): ScoredLead {
  const p = c.place;
  const signals = c.signals;

  /* ── Fit (30): vertical match, geography within radius, business type ── */
  let fit = 14;
  const wantedVertical = icp.targetVerticals.value.toLowerCase();
  const categories = p.categories.join(" ").toLowerCase();
  if (wantedVertical && categories && wantedVertical.split(/[,&]/).some((v) => categories.includes(v.trim().split(" ")[0])))
    fit += 9;
  else if (categories) fit += 4;
  if (p.city) fit += 4;                       // inside the sourced radius
  if (p.reviewCount !== null) fit += 3;       // a real, listed local business
  fit = clamp(fit, 0, SCORE_WEIGHTS.fit);

  /* ── Pain (30): number and severity of gaps that map to what they sell ── */
  let pain = 0;
  if (!fitOnly) {
    const weight = (s: DetectedSignal) =>
      (s.severity === "high" ? 4.2 : s.severity === "med" ? 2.6 : 1.2) * s.confidence;
    pain = signals.reduce((a, s) => a + weight(s), 0);
    // A prospect with gaps across several families is worth more than one
    // with three variations of the same problem.
    const families = new Set(signals.map((s) => s.family)).size;
    pain += families * 1.6;
  }
  pain = clamp(Math.round(pain), 0, SCORE_WEIGHTS.pain);

  /* ── Ability to pay (25): locations, demand proxy, ad spend, scale ── */
  let pay = 6;
  pay += Math.min(6, (p.locationCount - 1) * 3);
  const reviews = p.reviewCount ?? 0;
  pay += reviews >= 200 ? 7 : reviews >= 80 ? 5 : reviews >= 30 ? 3 : 1;
  if (signals.some((s) => s.key.startsWith("ppc.") && s.key !== "ppc.losing_share")) pay += 5; // active spend
  if (signals.some((s) => s.family === "ecommerce")) pay += 3;
  pay = clamp(pay, 0, SCORE_WEIGHTS.pay);

  /* ── Reachability (15): verified phone, email quality, named owner ── */
  let reach = 0;
  if (p.phone) reach += 7;
  if (c.phoneLineType && c.phoneLineType !== "voip") reach += 2;
  reach += c.emailIsRole ? 2 : 4;             // a named address beats a role one
  if (p.website) reach += 2;
  reach = clamp(reach, 0, SCORE_WEIGHTS.reach);

  const total = fit + pain + pay + reach;

  const top = [...signals].sort(
    (a, b) =>
      (b.severity === "high" ? 3 : b.severity === "med" ? 2 : 1) * b.confidence -
      (a.severity === "high" ? 3 : a.severity === "med" ? 2 : 1) * a.confidence
  );

  return {
    candidate: c,
    breakdown: { fit, pain, pay, reach, total },
    headlineGap: fitOnly
      ? "Findings pending — audits are still catching up for this prospect"
      : top.slice(0, 2).map((s) => s.measurement).join(" · ") || "No gaps detected in the audited families",
    tagLabel: tagFor(top),
    benchmark: top.find((s) => s.benchmark)?.benchmark ?? null,
  };
}

/** The short service badge on the results row, e.g. "Web + SEO". */
function tagFor(signals: DetectedSignal[]): string {
  const LABEL: Record<string, string> = {
    web: "Web", seo: "SEO", ppc: "PPC",
    content: "Content", ecommerce: "eCommerce", ai: "AI intake",
  };
  const families = [...new Set(signals.slice(0, 4).map((s) => s.family))].slice(0, 2);
  return families.map((f) => LABEL[f]).join(" + ") || "Fit only";
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Cap the list at 15–25. Long lists read as low quality, and a list nobody
 * finishes reading is a list nobody keeps. Never pad with weaker leads to
 * hit a number — show what passed and say how many were filtered. Plan §5.5
 */
export function capShortlist<T>(rows: T[], min = 15, max = 25): T[] {
  return rows.slice(0, Math.max(min, Math.min(max, rows.length)));
}
