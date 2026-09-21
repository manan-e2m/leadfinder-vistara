/**
 * Opt-in results-link expiry.
 *
 * RESULT_LINK_TTL_HOURS (default 0) controls how long a results link stays
 * valid after the run finished. 0 / unset = never expires — the demo
 * default, so conference QR links always work. When set, a shared link
 * older than the TTL is refused by the results page and the data API.
 *
 * Age is measured from finishedAt (fallback startedAt) for terminal runs;
 * a run that is still executing has no finishedAt and never counts as
 * expired (it must remain viewable while it runs).
 */
import { db } from "./db";

export const RESULT_LINK_TTL_MS = (() => {
  const h = Number(process.env.RESULT_LINK_TTL_HOURS ?? 0);
  return Number.isFinite(h) && h > 0 ? h * 3_600_000 : 0;
})();

/**
 * true when the link is expired. Only meaningful when the TTL is on.
 */
export function isLinkExpired(run: {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
}): boolean {
  if (RESULT_LINK_TTL_MS <= 0) return false;
  if (!["complete", "degraded", "failed"].includes(run.status)) return false;
  const anchor = run.finishedAt ?? run.startedAt;
  return Date.now() - new Date(anchor).getTime() > RESULT_LINK_TTL_MS;
}

/**
 * Minimal row fetch for the guard (kept off lib/results.ts so the expiry
 * check costs one tiny query, and so the full results read is untouched).
 * Returns null when the run does not exist at all — the caller should
 * treat that as a normal notFound, not as expired.
 */
export async function rawRunForLinkGuard(runId: string) {
  return db.run.findUnique({
    where: { id: runId },
    select: { status: true, startedAt: true, finishedAt: true },
  });
}
