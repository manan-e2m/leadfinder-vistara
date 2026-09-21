import type { TechProfile, PageSpeedResult, AdActivity, GbpProfile, PlaceRecord } from "@/providers";
import type { DetectedSignal } from "@/lib/types";

/** Everything an audit family is allowed to look at. */
export interface AuditContext {
  business: {
    name: string;
    domain: string | null;
    city: string | null;
    metro: string;
    locationCount: number;
    reviewCount: number | null;
    reviewLatestAt: Date | null;
    ownerRespondsToReviews: boolean;
    place: PlaceRecord | null;
  };
  tech: TechProfile | null;
  speed: PageSpeedResult | null;
  ads: AdActivity | null;
  gbpProfile: GbpProfile | null;
  /** Core service terms for the vertical, used for local-pack checks. */
  coreTerms: string[];
  localPack: { term: string; inPack: boolean; position: number | null }[];
  /** Resolves a benchmark line, or null when the corpus is unavailable. */
  benchmarkFor: (metric: string, value: number) => Promise<string | null>;
}

export type AuditFn = (ctx: AuditContext) => Promise<DetectedSignal[]>;

export const daysSince = (d: Date | null | undefined): number | null =>
  d ? Math.floor((Date.now() - d.getTime()) / 864e5) : null;

export const monthsSince = (d: Date | null | undefined): number | null => {
  const days = daysSince(d);
  return days === null ? null : Math.floor(days / 30.44);
};
