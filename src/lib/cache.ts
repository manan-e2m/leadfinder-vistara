import { db } from "./db";
import { packJson, readJson } from "./json";

/**
 * Cache keyed on metro + vertical, at both the candidate-pool level and the
 * per-business audit level. Two agencies targeting dentists in the same
 * metro share a pool and its audits — the single biggest cost and latency
 * saver in the build. During pre-computation the cache is warmed for every
 * metro and vertical in the registration list, so even walk-ins usually hit
 * warm data. Plan §9.2, §12.1
 */

const TTL_DAYS: Record<string, number> = {
  pool: 10,     // candidate pools: 7–14 days
  audit: 7,     // per-business audits
  icp: 30,      // an agency's own ICP changes slowly
};

export function poolKey(metro: string, vertical: string) {
  return `pool:${slug(metro)}:${slug(vertical)}`;
}
export function auditKey(domain: string, family: string) {
  return `audit:${slug(domain)}:${family}`;
}
export function icpKey(domain: string, agencyName?: string) {
  // The cached IcpResult embeds the brand (tone/name/colours) which is
  // derived from the agency NAME, not just the domain. Two teammates of
  // the same agency typing different names ("Acme" vs "Acme Digital")
  // previously shared one cache entry and the second got the first's
  // brand in their confirm card and every generated opener.
  return `icp:${slug(domain)}${agencyName ? `:${slug(agencyName)}` : ""}`;
}

function slug(s: string) {
  return (s || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const row = await db.cachePool.findUnique({ where: { key } }).catch(() => null);
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  await db.cachePool.update({ where: { key }, data: { hits: { increment: 1 } } }).catch(() => {});
  return readJson<T | null>(row.payload, null);
}

export async function cacheSet(key: string, kind: keyof typeof TTL_DAYS, value: unknown) {
  const expiresAt = new Date(Date.now() + TTL_DAYS[kind] * 864e5);
  const payload = packJson(value);
  await db.cachePool
    .upsert({
      where: { key },
      create: { key, kind, payload, expiresAt },
      update: { payload, expiresAt },
    })
    .catch(() => {});
}

export async function cacheStats() {
  const rows = await db.cachePool.findMany({ select: { kind: true, hits: true } });
  const byKind: Record<string, { entries: number; hits: number }> = {};
  for (const r of rows) {
    byKind[r.kind] ??= { entries: 0, hits: 0 };
    byKind[r.kind].entries++;
    byKind[r.kind].hits += r.hits;
  }
  return byKind;
}
