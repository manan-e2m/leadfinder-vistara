/**
 * Capture accepts bare domains, full URLs and common typos, and dedupes on
 * the registrable domain so teammates from one agency share a workspace.
 * Plan §5.1
 */

const COMMON_TLD_TYPOS: Record<string, string> = {
  con: "com", cmo: "com", ocm: "com", "com.": "com", cm: "com", vom: "com",
  nte: "net", ogr: "org", "co,": "co",
};

export type NormalizeResult =
  | { ok: true; domain: string; corrected: boolean; input: string }
  | { ok: false; reason: string; input: string };

export function normalizeDomain(input: string): NormalizeResult {
  const original = (input ?? "").trim();
  if (!original) return { ok: false, reason: "empty", input: original };

  let s = original.toLowerCase();
  let corrected = false;

  s = s.replace(/^[a-z]+:\/\//, "");        // protocol
  s = s.replace(/^www\./, "");               // www
  s = s.split(/[/?#]/)[0];                   // path, query, fragment
  s = s.replace(/:\d+$/, "");                // port
  s = s.replace(/[.,;]+$/, "");              // trailing punctuation
  s = s.replace(/\s+/g, "");

  if (!s) return { ok: false, reason: "empty_after_normalize", input: original };

  const parts = s.split(".");

  // No dot at all — assume the person typed "acmeagency" and meant .com.
  if (parts.length === 1) {
    if (!/^[a-z0-9-]{2,}$/.test(parts[0]))
      return { ok: false, reason: "not_a_domain", input: original };
    return { ok: true, domain: `${parts[0]}.com`, corrected: true, input: original };
  }

  const tld = parts[parts.length - 1];
  if (COMMON_TLD_TYPOS[tld]) {
    parts[parts.length - 1] = COMMON_TLD_TYPOS[tld];
    corrected = true;
  }

  const domain = parts.join(".");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain))
    return { ok: false, reason: "not_a_domain", input: original };
  if (domain.length > 253)
    return { ok: false, reason: "too_long", input: original };

  return { ok: true, domain, corrected, input: original };
}

export function agencyNameFromDomain(domain: string): string {
  const base = domain.split(".")[0].replace(/[-_]+/g, " ");
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}
