import { z } from "zod";

/* ─────────────────────────── ICP ───────────────────────────
 * Inference is never all-or-nothing. We may be confident about geography
 * and unsure about vertical, so every field carries its own confidence.
 * Fields above threshold render filled; fields below render as a question
 * with tappable chips. Plan §5.2, §6.4
 */

export const CONFIDENCE_THRESHOLD = 0.62;

export const ConfidentField = z.object({
  value: z.string(),
  confidence: z.number().min(0).max(1),
  /** which sources agreed, shown under the field on the confirm card */
  sources: z.array(z.string()).default([]),
  /** tappable options when confidence is below threshold */
  options: z.array(z.string()).default([]),
  /** true once the attendee has tapped to confirm or correct it */
  confirmed: z.boolean().default(false),
});
export type ConfidentField = z.infer<typeof ConfidentField>;

export const IcpSchema = z.object({
  servicesOffered: ConfidentField,
  targetVerticals: ConfidentField,
  geography: ConfidentField,
  dealSizeTier: ConfidentField,
  proofPoints: z.array(z.string()).default([]),
  recencySignals: z.array(z.string()).default([]),
  /** metro slug used as half the cache key. Plan §9.2 */
  metro: z.string().default("unknown"),
  radiusMiles: z.number().default(25),
  /** true when every source came back thin and we fell through to the
   *  three tap-only questions. Plan §6.5 */
  fromFallback: z.boolean().default(false),
});
export type Icp = z.infer<typeof IcpSchema>;

export const BrandAssets = z.object({
  logoUrl: z.string().nullable().default(null),
  primary: z.string().default("#0F6B6B"),
  secondary: z.string().default("#08090C"),
  tone: z.string().default("direct, plain-spoken, no jargon"),
  agencyName: z.string().default(""),
  /** true when extraction failed and we fell back to a neutral template
   *  carrying their name and domain. Still theirs, still sendable. */
  neutral: z.boolean().default(false),
});
export type BrandAssets = z.infer<typeof BrandAssets>;

/* ─────────────────────── Routing fork ───────────────────────
 * The confirmed card picks the route — nobody taps it. Running every audit
 * type on every business would burn the time budget and return findings
 * nobody asked about. Workflow doc, "Route before you audit".
 */

export type RouteKind =
  | "local_service"
  | "regional_b2b"
  | "ecommerce"
  | "budget_qualified";

export interface RouteDecision {
  /** more than one may apply; results merge into a single deduped list */
  routes: RouteKind[];
  primary: RouteKind;
  /** audit families this route cares about */
  auditFamilies: AuditFamily[];
  reason: string;
  /** set when vertical confidence was low and we defaulted to the cheapest
   *  route while retrying a better match in the background */
  defaulted: boolean;
}

/* ─────────────────────────── Signals ─────────────────────────── */

export type AuditFamily = "web" | "ecommerce" | "seo" | "ppc" | "content" | "ai";
export type Severity = "high" | "med" | "low";

export interface DetectedSignal {
  key: string;
  label: string;
  /** the checkable number — this is what makes the room trust it */
  measurement: string;
  source: string;
  severity: Severity;
  /** below 0.6 the finding is labelled lower-confidence on screen rather
   *  than presented like a verified one. Workflow change 06 */
  confidence: number;
  family: AuditFamily;
  service: string;
  pitch: string;
  benchmark?: string;
}

/** Signal family → the E2M service that delivers the fix. Plan §5.4, App. B */
export const SERVICE_BY_FAMILY: Record<AuditFamily, string> = {
  web: "WordPress & web development",
  ecommerce: "eCommerce",
  seo: "SEO",
  ppc: "PPC",
  content: "Content",
  ai: "AI services",
};

/* ─────────────────────────── Scoring ───────────────────────────
 * Score = Fit × Pain × Ability to pay × Reachability, each component shown
 * to the attendee. Weights are provisional and get tuned in weeks 10–13
 * against what partner agencies actually open and export. Plan §5.5
 */

export const SCORE_WEIGHTS = { fit: 30, pain: 30, pay: 25, reach: 15 } as const;

export interface ScoreBreakdown {
  fit: number;
  pain: number;
  pay: number;
  reach: number;
  total: number;
}

/* ─────────────────────── Progress reporting ─────────────────────── */

export interface StageProgress {
  stage: string;
  label: string;
  status: "pending" | "running" | "ok" | "fallback" | "failed";
  detail?: string;
  ms?: number;
}

export interface RunProgress {
  runId: string;
  status: string;
  stages: StageProgress[];
  candidateCount: number;
  auditedCount: number;
  heldBackCount: number;
  leadCount: number;
  costCents: number;
  totalMs: number | null;
}
