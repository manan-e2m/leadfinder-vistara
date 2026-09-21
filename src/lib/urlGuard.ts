/**
 * SSRF guard for user-supplied scan targets.
 *
 * The scan endpoint fetches whatever domain a visitor types (techdetect,
 * PageSpeed, verify all fetch it). Without this, `127.0.0.1`,
 * `169.254.169.254` (cloud metadata) or an RFC1918 address pass
 * normalizeDomain's character check and get fetched from the server.
 *
 * Two levels:
 *  - assertPublicDomain: full check incl. DNS resolution — for endpoints that
 *    accept raw user input (/api/scan).
 *  - isBlockedHostSync: literal-only check (no DNS) — for live fetch helpers
 *    that run per-candidate and must stay cheap.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedHostError extends Error {
  constructor(public host: string, reason: string) {
    super(`blocked host "${host}": ${reason}`);
    this.name = "BlockedHostError";
  }
}

const BLOCKED_HOSTNAME_RE =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.localdomain|metadata\.google\.internal)$/i;

/** Private / non-routable IPv4 ranges (loopback, RFC1918, link-local, CGNAT, 0.0.0.0/8). */
function isPrivateIPv4(ip: string): boolean {
  const n = ip.split(".").map(Number);
  const [a, b] = n;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true;
  if (low.startsWith("fe8") || low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb"))
    return true; // link-local fe80::/10
  if (low.startsWith("fc") || low.startsWith("fd")) return true; // unique-local fc00::/7
  // IPv4-mapped (::ffff:127.0.0.1) — re-check the embedded v4.
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true; // unparseable → treat as hostile
}

/** Strip port / brackets / scheme remnants so we always judge the bare host. */
export function bareHost(raw: string): string {
  let s = (raw ?? "").trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "");
  s = s.split(/[/?#]/)[0];
  s = s.replace(/:\d+$/, "");
  s = s.replace(/^\[|\]$/g, "");
  return s;
}

/**
 * Cheap, synchronous check: hostnames that are blocked by name, or IP
 * literals in non-routable ranges. Does NOT resolve DNS — a public-looking
 * hostname that resolves to 10.x.x.x gets through this; use
 * assertPublicDomain where the input is user-controlled.
 */
export function isBlockedHostSync(raw: string): boolean {
  const host = bareHost(raw);
  if (!host) return true;
  if (BLOCKED_HOSTNAME_RE.test(host)) return true;
  if (isIP(host)) return isPrivateIp(host);
  return false;
}

/**
 * Full guard for user input: hostname checks + resolve all A/AAAA records
 * and refuse if ANY resolved address is private/non-routable. Throws
 * BlockedHostError; callers map it to a 400.
 */
export async function assertPublicDomain(raw: string): Promise<void> {
  const host = bareHost(raw);
  if (!host) throw new BlockedHostError(raw, "empty host");
  if (BLOCKED_HOSTNAME_RE.test(host))
    throw new BlockedHostError(host, "internal hostname");
  if (isIP(host)) {
    if (isPrivateIp(host))
      throw new BlockedHostError(host, "private/non-routable IP");
    return;
  }
  // Hostname must look like a real domain (same shape normalizeDomain allows).
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host))
    throw new BlockedHostError(host, "not a public domain");

  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new BlockedHostError(host, "does not resolve");
  }
  if (!addrs.length) throw new BlockedHostError(host, "does not resolve");
  for (const { address } of addrs) {
    if (isPrivateIp(address))
      throw new BlockedHostError(host, `resolves to non-routable address ${address}`);
  }
}
