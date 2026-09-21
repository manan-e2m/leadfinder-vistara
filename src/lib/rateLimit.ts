/**
 * In-memory fixed-window rate limiter for unauthenticated, cost-bearing
 * endpoints. Keyed by client IP (x-forwarded-for first hop behind a proxy).
 *
 * Good enough for a single-process Next.js deployment; if the app is ever
 * scaled to multiple instances, move the counters to Redis.
 */

const WINDOW_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Periodically drop expired buckets so the map cannot grow unbounded. */
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Take one token for `key`. Returns ok=false with retry-after once the
 * per-minute limit is exhausted.
 */
export function rateLimit(key: string, limit: number): RateResult {
  const now = Date.now();
  sweep(now);

  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (b.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }
  b.count++;
  return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
}
