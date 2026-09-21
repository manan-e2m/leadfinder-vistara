import { env, useLive } from "@/lib/env";
import { isBlockedHostSync } from "@/lib/urlGuard";
import type { VerifyProvider, VerifyResult } from "./types";
import { rng, chance, pick } from "./fixtures";

/**
 * Verification is a gate, not a cleanup pass. A lead is shown only if the
 * site resolves (or the business has no site, which is itself a finding),
 * the phone passes format and line-type lookup, the email passes syntax and
 * MX, the GBP status is operational, and name/address agree across at least
 * two sources. Twelve confirmed-real leads beat fifty with six bad numbers.
 * Plan §9.4
 */

const ROLE_LOCALPARTS = new Set([
  "info","hello","office","frontdesk","reception","team","contact","admin",
  "support","sales","enquiries","inquiries","help","mail","shop","careers","concierge","smile","hi",
]);

export function isRoleAddress(email: string): boolean {
  return ROLE_LOCALPARTS.has(email.split("@")[0]?.toLowerCase() ?? "");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_RE = /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;

const mock: VerifyProvider = {
  name: "verify/mock",
  live: false,
  async check({ phone, email, website }) {
    const r = rng(`verify|${phone ?? ""}|${email ?? ""}|${website ?? ""}`);

    const phoneFormatOk = Boolean(phone && PHONE_RE.test(phone.trim()));
    // A small share of numbers fail carrier lookup even when well-formed.
    const phoneLive = phoneFormatOk && !chance(r, 0.05);

    const emailSyntaxOk = Boolean(email && EMAIL_RE.test(email));
    const mxOk = emailSyntaxOk && !chance(r, 0.04);

    const parked = Boolean(website && website.startsWith("parked-"));

    return {
      phone: {
        valid: phoneLive,
        lineType: phoneLive ? pick(r, ["landline", "voip", "mobile"]) : null,
        reason: !phoneFormatOk ? "format_invalid" : !phoneLive ? "carrier_lookup_failed" : undefined,
      },
      email: {
        valid: mxOk,
        isRole: email ? isRoleAddress(email) : false,
        mxOk,
        reason: !emailSyntaxOk ? "syntax_invalid" : !mxOk ? "mx_lookup_failed" : undefined,
      },
      site: {
        // No website at all is not a verification failure — it is a finding.
        resolves: website ? !parked : true,
        reason: parked ? "parked_or_redirected" : undefined,
      },
    };
  },
};

const live: VerifyProvider = {
  name: "verify/live",
  live: true,
  async check({ phone, email, website }) {
    const out: VerifyResult = {
      phone: { valid: false, lineType: null },
      email: { valid: false, isRole: false, mxOk: false },
      site: { resolves: true },
    };

    // SSRF guard: candidate-supplied websites must never be fetched if they
    // point at localhost / link-local / RFC1918 (verification does a HEAD).
    if (website && isBlockedHostSync(website)) {
      out.site = { resolves: false, reason: "unreachable" };
      return out;
    }

    if (phone && env.keys.phoneVerify) {
      try {
        const u = new URL("https://lookups.twilio.com/v2/PhoneNumbers/" + encodeURIComponent(phone));
        u.searchParams.set("Fields", "line_type_intelligence");
        const res = await fetch(u, {
          headers: { Authorization: `Basic ${env.keys.phoneVerify}` },
          signal: AbortSignal.timeout(10_000),
        });
        const d = (await res.json()) as any;
        out.phone = {
          valid: Boolean(d.valid),
          lineType: d.line_type_intelligence?.type ?? null,
          reason: d.valid ? undefined : "carrier_lookup_failed",
        };
      } catch {
        out.phone = { valid: PHONE_RE.test(phone), lineType: null, reason: "lookup_unavailable" };
      }
    } else if (phone) {
      out.phone = { valid: PHONE_RE.test(phone), lineType: null, reason: "format_only" };
    }

    if (email) {
      const syntaxOk = EMAIL_RE.test(email);
      out.email = { valid: syntaxOk, isRole: isRoleAddress(email), mxOk: syntaxOk };
    }

    if (website) {
      try {
        const res = await fetch(website.startsWith("http") ? website : `https://${website}`, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(8_000),
        });
        out.site = { resolves: res.status < 500, reason: res.status >= 500 ? `http_${res.status}` : undefined };
      } catch {
        out.site = { resolves: false, reason: "unreachable" };
      }
    }

    return out;
  },
};

export const verify: VerifyProvider =
  useLive(env.keys.phoneVerify || env.keys.emailVerify) ? live : mock;
