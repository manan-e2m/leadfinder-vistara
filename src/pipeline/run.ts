import { db } from "@/lib/db";
import { packJson, readJson } from "@/lib/json";
import { log, logFailure } from "@/lib/logger";
import { RunBudget } from "@/lib/cost";
import { resetLlmBudget, runLlmScope } from "@/providers";
import { markRunInactive, markRunActive } from "@/lib/runRecovery";
import type { Icp, BrandAssets, RouteDecision } from "@/lib/types";
import { decideRoute } from "./stages/route";
import { sourceCandidates } from "./stages/source";
import { runAudits } from "./stages/audit";
import { verifyCandidates } from "./stages/verify";
import { scoreAll, capShortlist, type ScoredLead } from "./stages/score";
import { personalize } from "./stages/personalize";
import { randomUUID } from "node:crypto";

/**
 * The orchestrator.
 *
 * Stages run as a sequence of independent steps, each with its own budget and
 * its own fallback, so a slow or failed stage DEGRADES the result rather than
 * blocking it. The invariant across the whole pipeline: the attendee always
 * reaches a results screen with something real on it. Plan §5, §9.5, App. C
 */

const TARGET_LEADS = 20;
const BACKFILL_MARGIN = 10;

/** In-process progress, polled by the running screen. */
const liveProgress = new Map<string, { label: string; detail?: string }>();
export function progressFor(runId: string) {
  return liveProgress.get(runId) ?? null;
}

export async function executeRun(args: {
  runId: string;
  workspaceId: string;
  domain: string;
  icp: Icp;
  brand: BrandAssets;
}): Promise<void> {
  // Scope the per-run LLM token ledger to this run's async chain so
  // concurrent runs each enforce their own LLM_MAX_TOKENS_PER_RUN.
  return runLlmScope(args.runId, () => executeRunInner(args));
}

async function executeRunInner(args: {
  runId: string;
  workspaceId: string;
  domain: string;
  icp: Icp;
  brand: BrandAssets;
}): Promise<void> {
  const { runId, workspaceId, domain, icp, brand } = args;
  const budget = new RunBudget(runId);
  const fallbacks: string[] = [];
  const startedAt = Date.now();
  resetLlmBudget(runId);
  markRunActive(runId);

  const stage = async <T,>(
    name: string,
    fn: () => Promise<T>,
    onFallback?: (e: unknown) => Promise<T>
  ): Promise<T> => {
    const t0 = Date.now();
    try {
      const value = await fn();
      await db.stageLog.create({
        data: { runId, stage: name, status: "ok", ms: Date.now() - t0 },
      }).catch(() => {});
      return value;
    } catch (e) {
      const reason = (e as Error).message;
      await logFailure({ stage: name, reason, url: domain, runId });
      if (!onFallback) {
        await db.stageLog.create({
          data: { runId, stage: name, status: "failed", ms: Date.now() - t0, reason },
        }).catch(() => {});
        throw e;
      }
      fallbacks.push(name);
      const value = await onFallback(e);
      await db.stageLog.create({
        data: { runId, stage: name, status: "fallback", ms: Date.now() - t0, reason },
      }).catch(() => {});
      return value;
    }
  };

  try {
    await db.run.update({ where: { id: runId }, data: { status: "running" } });

    /* ── The fork: route before you audit ─────────────────────── */
    liveProgress.set(runId, { label: "Choosing the sourcing route" });
    const route: RouteDecision = decideRoute(icp);
    await db.workspace.update({
      where: { id: workspaceId },
      data: { routeJson: packJson(route) },
    });
    await db.stageLog.create({
      data: {
        runId, stage: "route", status: route.defaulted ? "fallback" : "ok", ms: 0,
        reason: route.reason, metaJson: packJson(route),
      },
    }).catch(() => {});
    if (route.defaulted) fallbacks.push("route");

    /* ── Stage 3: source ──────────────────────────────────────── */
    liveProgress.set(runId, { label: `Finding ${icp.targetVerticals.value || "businesses"} near ${icp.metro}` });
    const sourced = await stage(
      "source",
      () => sourceCandidates({ icp, route, budget }),
      async () => ({
        candidates: [], widenedNote: "Sourcing degraded. Showing cached results only",
        fromCache: true, effectiveRadius: icp.radiusMiles, sourcesUsed: [],
      })
    );

    await db.run.update({
      where: { id: runId },
      data: { candidateCount: sourced.candidates.length },
    });
    liveProgress.set(runId, {
      label: `Found ${sourced.candidates.length} ${icp.targetVerticals.value || "businesses"} within ${sourced.effectiveRadius} mi`,
      detail: sourced.widenedNote ?? undefined,
    });

    if (sourced.candidates.length === 0) {
      await finish(runId, "degraded", startedAt, fallbacks, budget);
      return;
    }

    /* ── Stage 4: audit ───────────────────────────────────────── */
    const auditResult = await stage(
      "audit",
      () =>
        runAudits({
          candidates: sourced.candidates,
          icp, route, budget,
          auditLimit: 120,
          onProgress: (done, total) => {
            liveProgress.set(runId, { label: `Auditing sites, reviews and ad activity (${done} of ${total})` });
            void db.run.update({ where: { id: runId }, data: { auditedCount: done } }).catch(() => {});
          },
        }),
      async () => ({ audited: sourced.candidates.map((p) => ({ place: p, signals: [], partial: true })), auditedCount: 0, failedAudits: sourced.candidates.length, allFailed: true, degradedByCost: false })
    );
    if (auditResult.degradedByCost) fallbacks.push("audit:cost_cap");

    /* ── Stage 5: verify, BEFORE scoring ──────────────────────── */
    liveProgress.set(runId, { label: "Verifying phone, email and business status" });
    const verified = await stage(
      "verify",
      () =>
        verifyCandidates({
          audited: auditResult.audited,
          budget,
          need: TARGET_LEADS + BACKFILL_MARGIN,
          runId,
        }),
      async () => ({ passed: [], heldBack: [] })
    );

    liveProgress.set(runId, {
      label: "Verifying phone, email and business status",
      detail: verified.heldBack.length
        ? `${verified.heldBack.length} candidates held back, backfilled`
        : undefined,
    });
    await db.run.update({
      where: { id: runId },
      data: { heldBackCount: verified.heldBack.length },
    });

    /* ── Stage 6: score ───────────────────────────────────────── */
    liveProgress.set(runId, { label: "Scoring and ranking against your ICP" });
    const scored = capShortlist(
      scoreAll({ candidates: verified.passed, icp, fitOnly: auditResult.allFailed })
    );
    if (auditResult.allFailed) fallbacks.push("score:fit_only");

    /* ── Stage 7: personalize + persist ───────────────────────── */
    liveProgress.set(runId, { label: "Drafting openers and building branded audits" });

    let rank = 0;
    let failedLeads = 0;
    const leadErrors: string[] = [];
    for (const s of scored) {
      try {
        await persistLead({ runId, s, rank: rank + 1, icp, brand, budget });
        rank++;
      } catch (leadErr) {
        // One bad lead (bad data, LLM hiccup, constraint collision) must
        // never destroy the run. Skip it, log it, keep going.
        failedLeads++;
        const reason = (leadErr as Error)?.message ?? String(leadErr);
        leadErrors.push(`#${rank + 1} ${s.candidate.place.name}: ${reason}`);
        await logFailure({
          stage: "personalize",
          reason: `lead skipped: ${reason}`,
          url: s.candidate.place.website,
          runId,
        });
        await db.stageLog.create({
          data: {
            runId, stage: "personalize", status: "failed", ms: 0,
            reason: `lead skipped: ${reason}`.slice(0, 500),
          },
        }).catch(() => {});
        liveProgress.set(runId, {
          label: "Drafting openers and building branded audits",
          detail: failedLeads > 0 ? `${failedLeads} lead(s) skipped due to errors` : undefined,
        });
      }
    }

    if (leadErrors.length) {
      fallbacks.push(`personalize:skipped_${leadErrors.length}_leads`);
    }

    await db.run.update({
      where: { id: runId },
      data: { leadCount: rank },
    }).catch(() => {});

    // Partial success: we produced at least one lead despite failures —
    // the attendee still gets a results screen. Full failure only when
    // nothing at all was produced.
    const hadStageFallbacks = fallbacks.some((f) => !f.startsWith("personalize:skipped"));
    if (rank === 0 && failedLeads > 0) {
      await logFailure({
        stage: "run",
        reason: `all ${failedLeads} leads failed during personalize: ${leadErrors.join("; ")}`.slice(0, 500),
        url: domain,
        runId,
      });
      await finish(runId, "failed", startedAt, fallbacks, budget);
      return;
    }

    await finish(
      runId,
      failedLeads > 0 || hadStageFallbacks ? "degraded" : "complete",
      startedAt,
      fallbacks,
      budget
    );
    log("info", "run", `${runId} finished — ${rank} leads, ${failedLeads} skipped, ${budget.spentCents.toFixed(1)}c, ${Date.now() - startedAt}ms`);
  } catch (e) {
    await logFailure({ stage: "run", reason: (e as Error).message, url: domain, runId });
    await finish(runId, "failed", startedAt, fallbacks, budget);
  } finally {
    liveProgress.delete(runId);
    markRunInactive(runId);
  }
}

/** Persist one scored candidate as Candidate + Lead + Opener + AuditDoc. */
async function persistLead(args: {
  runId: string;
  s: ScoredLead;
  rank: number;
  icp: Icp;
  brand: BrandAssets;
  budget: RunBudget;
}) {
  const { runId, s, rank, icp, brand, budget } = args;
  const p = s.candidate.place;

  const candidate = await db.candidate.create({
        data: {
          runId,
          name: p.name,
          website: p.website,
          phone: p.phone,
          email: p.email ?? null,
          addressLine: p.addressLine,
          city: p.city,
          region: p.region,
          postalCode: p.postalCode,
          lat: p.lat, lng: p.lng,
          rating: p.rating,
          reviewCount: p.reviewCount,
          reviewLatestAt: p.reviewLatestAt,
          businessStatus: p.businessStatus,
          locationCount: p.locationCount,
          externalId: p.externalId,
          sourceName: p.externalId.startsWith("mock_b2b") ? "apollo" : "places",
          rawJson: packJson({ attribution: p.attribution, categories: p.categories }),
          verified: true,
          phoneLineType: s.candidate.phoneLineType,
          emailIsRole: s.candidate.emailIsRole,
          signals: {
            create: s.candidate.signals.map((sig) => ({
              key: sig.key, label: sig.label, measurement: sig.measurement,
              source: sig.source, severity: sig.severity, confidence: sig.confidence,
              family: sig.family, service: sig.service, pitch: sig.pitch,
              benchmark: sig.benchmark ?? null,
            })),
          },
        },
      });

      const personal = await personalize({ lead: s, icp, brand, budget });

      const lead = await db.lead.create({
        data: {
          runId,
          candidateId: candidate.id,
          rank,
          score: s.breakdown.total,
          fit: s.breakdown.fit,
          pain: s.breakdown.pain,
          pay: s.breakdown.pay,
          reach: s.breakdown.reach,
          headlineGap: s.headlineGap,
          tagLabel: s.tagLabel,
          benchmark: s.benchmark,
          degraded: personal.origin === "template",
          openers: {
            create: [
              { channel: "email", subject: personal.emailSubject, body: personal.emailBody, origin: personal.origin },
              { channel: "phone", body: personal.phoneOpener, origin: personal.origin },
            ],
          },
        },
      });

      await db.auditDoc.create({
        data: {
          leadId: lead.id,
          token: randomUUID().replace(/-/g, "").slice(0, 16),
          brandJson: packJson(brand),
          findingsJson: packJson(personal.auditFindings),
          planSummary: personal.auditPlan,
        },
      });
}

async function finish(
  runId: string,
  status: string,
  startedAt: number,
  fallbacks: string[],
  budget: RunBudget
) {
  await budget.flush();
  await db.run.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      totalMs: Date.now() - startedAt,
      fallbacksJson: packJson(fallbacks),
    },
  }).catch(() => {});
}

/* ── The seven steps the progress screen names, honestly ────────── */
export const PIPELINE_STEPS = [
  { key: "icp",         label: "Reading your footprint across 6 sources" },
  { key: "route",       label: "Choosing the sourcing route" },
  { key: "source",      label: "Finding businesses that match your ICP" },
  { key: "audit",       label: "Auditing sites, reviews and ad activity" },
  { key: "verify",      label: "Verifying phone, email and business status" },
  { key: "score",       label: "Scoring and ranking against your ICP" },
  { key: "personalize", label: "Drafting openers and building branded audits" },
] as const;

export function fallbacksOf(run: { fallbacksJson: string | null }): string[] {
  return readJson<string[]>(run.fallbacksJson, []);
}
