/**
 * Ops dashboard guard.
 *
 * OPS_TOKEN unset  -> open access (demo default, exactly as before).
 * OPS_TOKEN set    -> requests must present the token via
 *   Authorization: Bearer <token>, x-ops-token: <token>, or ?token=<token>.
 * A constant-time compare keeps timing attacks off the table; the token
 * also enables read of the SAME ops feed on /api/providers.
 */
import { env } from "./env";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function opsGuardEnabled(): boolean {
  return Boolean(env.opsToken);
}

/** Check an incoming Request against the configured OPS_TOKEN, if any. */
export function checkOpsToken(req: Request): boolean {
  if (!opsGuardEnabled()) return true;
  const url = new URL(req.url);
  const presented =
    req.headers.get("x-ops-token")?.trim() ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    url.searchParams.get("token") ||
    "";
  return safeEqual(presented, env.opsToken);
}
