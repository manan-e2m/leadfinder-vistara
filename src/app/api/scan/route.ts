import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { packJson } from "@/lib/json";
import { normalizeDomain, agencyNameFromDomain } from "@/lib/domain";
import { RunBudget } from "@/lib/cost";
import { assertPublicDomain, BlockedHostError } from "@/lib/urlGuard";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { env } from "@/lib/env";
import { logFailure } from "@/lib/logger";
import { inferIcp, needsConfirmation } from "@/pipeline/stages/icp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stage 1 → 2. Capture a domain, infer the ICP across six sources in
 * parallel, and hand back the confirm card. Teammates from one agency
 * dedupe onto one workspace (keyed on registrable domain). Plan §5.1–5.2
 *
 * Security:
 *  - SSRF: the input drives server-side fetches (techdetect, verify,
 *    PageSpeed). assertPublicDomain refuses localhost, link-local
 *    (169.254.169.254), RFC1918 and any hostname resolving to a
 *    non-routable address BEFORE any fetch happens.
 *  - Rate limit: this endpoint is unauthenticated and spends real API
 *    budget per call, so it is capped per client IP per minute.
 */
const SCAN_RATE_PER_MINUTE = Number(process.env.SCAN_RATE_PER_MINUTE ?? 6);

export async function POST(req: Request) {
  const rl = rateLimit(`scan:${clientIp(req)}`, SCAN_RATE_PER_MINUTE);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        message: `Too many scans. Try again in ${rl.retryAfterSec}s.`,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const norm = normalizeDomain(String(body.input ?? ""));
  if (!norm.ok) {
    return NextResponse.json(
      { error: "not_a_domain", message: "That doesn't look like a website. Try e.g. acmeagency.com" },
      { status: 400 }
    );
  }

  const domain = norm.domain;

  // SSRF guard — after normalization, before any server-side fetch.
  try {
    await assertPublicDomain(domain);
  } catch (e) {
    if (e instanceof BlockedHostError) {
      return NextResponse.json(
        { error: "blocked_host", message: "That address can't be scanned. Enter your agency's public website." },
        { status: 400 }
      );
    }
    throw e;
  }

  const providedName = String(body.agencyName ?? "").trim().slice(0, 120);
  const agencyName = providedName || agencyNameFromDomain(domain);

  // Only overwrite the stored name when the caller explicitly provides one —
  // never clobber a hand-QA'd name (from the registration list / precompute)
  // with a domain-derived guess. Plan §6.7
  const workspace = await db.workspace.upsert({
    where: { domain },
    update: providedName ? { agencyName: providedName } : {},
    create: { domain, agencyName },
  });

  // Create the run up front so ICP-inference cost charges against a real row.
  // mode used to be hardcoded "live" — the ops board mislabeled mock demos.
  const run = await db.run.create({
    data: {
      workspaceId: workspace.id,
      status: "queued",
      mode: env.providerMode === "mock" ? "mock" : "live",
    },
  });

  let inferred;
  try {
    const budget = new RunBudget(run.id);
    inferred = await inferIcp({ domain, agencyName, budget });
    await budget.flush();
  } catch (e) {
    // ICP inference throws on unexpected internal errors; without this the
    // caller got a raw 500 with a stack trace. The run is already persisted,
    // so mark it failed rather than leaving a phantom queued row (which the
    // stale-run recovery would otherwise flag for 3+ minutes).
    await db.run
      .updateMany({
        where: { id: run.id, status: { notIn: ["complete", "degraded", "failed"] } },
        data: { status: "failed" },
      })
      .catch(() => {});
    await logFailure({ stage: "icp", reason: (e as Error).message, url: domain, runId: run.id });
    return NextResponse.json(
      { error: "icp_failed", message: "We couldn't read your site's footprint. Try again in a moment." },
      { status: 502 }
    );
  }

  await db.workspace.update({
    where: { id: workspace.id },
    data: { icpJson: packJson(inferred.icp), brandJson: packJson(inferred.brand) },
  });

  // Session-scoped white-labeling: once THIS scan's site has been read, the
  // whole app (home, confirm card, run, results, audit) wears the extracted
  // brand — the cookie flips loadBrandTheme from E2M chrome to the agency
  // theme. Cleared by "New scan" reset / natural expiry.
  const res = NextResponse.json({
    workspaceId: workspace.id,
    runId: run.id,
    domain,
    corrected: norm.corrected,
    icp: inferred.icp,
    brand: inferred.brand,
    sourcesUsed: inferred.sourcesUsed,
    fellBackToQuestions: inferred.fellBackToQuestions,
    siteFailure: inferred.siteFailure,
    needsConfirmation: needsConfirmation(inferred.icp),
  });
  res.cookies.set("lf_ws", workspace.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
