import { db } from "./db";
import { readJson } from "./json";
import { fallbacksOf } from "@/pipeline/run";
import { recoverIfStale } from "./runRecovery";
import type { BrandAssets } from "./types";

/**
 * The single shape the results screen, the export and the CRM push all read
 * from. Building it in one place keeps the API route and the server-rendered
 * page from drifting apart.
 */

export interface LeadView {
  id: string;
  rank: number;
  score: number;
  breakdown: { fit: number; pain: number; pay: number; reach: number };
  headlineGap: string;
  tagLabel: string;
  benchmark: string | null;
  degraded: boolean;
  business: {
    name: string;
    website: string | null;
    phone: string | null;
    city: string | null;
    region: string | null;
    rating: number | null;
    reviewCount: number | null;
    businessStatus: string;
    source: string;
  };
  signals: {
    key: string;
    label: string;
    measurement: string;
    source: string;
    severity: string;
    confidence: number;
    family: string;
    service: string;
    pitch: string;
    benchmark: string | null;
  }[];
  openers: {
    email: { subject: string | null; body: string; origin: string } | null;
    phone: { body: string; origin: string } | null;
  };
  auditToken: string | null;
}

export interface RunView {
  runId: string;
  status: string;
  mode: string;
  workspace: { id: string; agencyName: string | null; domain: string };
  brand: BrandAssets | null;
  counts: {
    candidate: number;
    audited: number;
    heldBack: number;
    lead: number;
  };
  costCents: number;
  cappedAt: string | null;
  totalMs: number | null;
  fallbacks: string[];
  leads: LeadView[];
}

export async function getRunResults(runId: string): Promise<RunView | null> {
  const run = await db.run.findUnique({
    where: { id: runId },
    include: {
      workspace: true,
      leads: {
        orderBy: { rank: "asc" },
        include: {
          candidate: { include: { signals: true } },
          openers: true,
          auditDoc: true,
        },
      },
    },
  });
  if (!run) return null;

  // Restart recovery: a run left "running"/"queued" by a server restart is
  // marked failed (past the staleness threshold) instead of spinning forever.
  await recoverIfStale(run);

  const leads: LeadView[] = run.leads.map((l) => {
    const emailOpener = l.openers.find((o) => o.channel === "email") ?? null;
    const phoneOpener = l.openers.find((o) => o.channel === "phone") ?? null;
    const c = l.candidate;
    return {
      id: l.id,
      rank: l.rank,
      score: l.score,
      breakdown: { fit: l.fit, pain: l.pain, pay: l.pay, reach: l.reach },
      headlineGap: l.headlineGap,
      tagLabel: l.tagLabel,
      benchmark: l.benchmark,
      degraded: l.degraded,
      business: {
        name: c.name,
        website: c.website,
        phone: c.phone,
        city: c.city,
        region: c.region,
        rating: c.rating,
        reviewCount: c.reviewCount,
        businessStatus: c.businessStatus,
        source: c.sourceName,
      },
      signals: c.signals.map((s) => ({
        key: s.key,
        label: s.label,
        measurement: s.measurement,
        source: s.source,
        severity: s.severity,
        confidence: s.confidence,
        family: s.family,
        service: s.service,
        pitch: s.pitch,
        benchmark: s.benchmark,
      })),
      openers: {
        email: emailOpener ? { subject: emailOpener.subject, body: emailOpener.body, origin: emailOpener.origin } : null,
        phone: phoneOpener ? { body: phoneOpener.body, origin: phoneOpener.origin } : null,
      },
      auditToken: l.auditDoc?.token ?? null,
    };
  });

  return {
    runId: run.id,
    status: run.status,
    mode: run.mode,
    workspace: {
      id: run.workspace.id,
      agencyName: run.workspace.agencyName,
      domain: run.workspace.domain,
    },
    brand: readJson<BrandAssets | null>(run.workspace.brandJson, null),
    counts: {
      candidate: run.candidateCount,
      audited: run.auditedCount,
      heldBack: run.heldBackCount,
      lead: run.leadCount,
    },
    costCents: run.costCents,
    cappedAt: run.cappedAt ? run.cappedAt.toISOString() : null,
    totalMs: run.totalMs,
    fallbacks: fallbacksOf(run),
    leads,
  };
}
