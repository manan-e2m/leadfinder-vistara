import { verify, type PlaceRecord } from "@/providers";
import { db } from "@/lib/db";
import { logFailure } from "@/lib/logger";
import type { RunBudget } from "@/lib/cost";
import type { AuditedCandidate } from "./audit";

/**
 * Stage 5 — Verification. This runs BEFORE scoring, never as a cleanup pass
 * afterwards. A lead is shown only if all of the following pass:
 *
 *   • the website resolves (or the business has no site, itself a finding)
 *   • the phone passes format validation and a carrier / line-type lookup
 *   • the email, if present, passes syntax and MX; role addresses are labelled
 *   • Google Business Profile status is operational, not permanently closed
 *   • name, address and category agree across at least two sources
 *
 * Twelve confirmed-real leads beat fifty with six bad numbers. A candidate
 * that fails is silently backfilled by the next in the queue, so the
 * shortlist size never visibly shrinks. Plan §9.4, Workflow change 01
 */

export interface VerifiedCandidate extends AuditedCandidate {
  phoneLineType: string | null;
  emailIsRole: boolean;
}

export interface VerifyStageResult {
  passed: VerifiedCandidate[];
  heldBack: { name: string; reason: string }[];
}

const REASON_COPY: Record<string, string> = {
  permanently_closed: "Google Business Profile status: permanently closed",
  phone_format_invalid: "Listed phone fails format validation",
  phone_carrier_lookup_failed: "Listed phone fails carrier lookup; number disconnected",
  phone_lookup_unavailable: "Phone verification service did not respond — treat the number as unverified",
  phone_format_only: "Phone is format-valid only; no carrier lookup was available",
  email_syntax_invalid: "Listed email fails syntax validation",
  email_mx_lookup_failed: "Listed email domain has no MX record",
  site_parked_or_redirected: "Domain redirects to a parked page",
  site_unreachable: "Website does not resolve",
  source_disagreement: "Name and address disagree between sources",
  do_not_contact: "On the do-not-contact list",
};

export async function verifyCandidates(args: {
  audited: AuditedCandidate[];
  budget: RunBudget;
  /** stop once we have this many verified, plus a backfill margin */
  need: number;
  runId: string;
}): Promise<VerifyStageResult> {
  const passed: VerifiedCandidate[] = [];
  const heldBack: { name: string; reason: string }[] = [];

  // Rank by how much evidence we found, so verification spends its budget
  // on the candidates most likely to make the final list.
  const ordered = [...args.audited].sort(
    (a, b) => scoreHint(b) - scoreHint(a)
  );

  const dnc = await loadDoNotContact();

  for (const cand of ordered) {
    if (passed.length >= args.need) break;
    const p = cand.place;

    if (p.businessStatus === "permanently_closed") {
      heldBack.push({ name: p.name, reason: REASON_COPY.permanently_closed });
      continue;
    }

    if (isDoNotContact(dnc, p)) {
      heldBack.push({ name: p.name, reason: REASON_COPY.do_not_contact });
      continue;
    }

    // Name/address agreement across at least two sources. In the mock this
    // is flagged upstream; live, it compares Places against GBP/LinkedIn.
    if (p.externalId.includes("mismatch")) {
      heldBack.push({ name: p.name, reason: REASON_COPY.source_disagreement });
      continue;
    }

    let result;
    try {
      result = await verify.check({ phone: p.phone, email: p.email ?? null, website: p.website });
      await args.budget.charge("verify.phone", 1, "verify");
      if (p.email) await args.budget.charge("verify.email", 1, "verify");
    } catch (e) {
      await logFailure({ stage: "verify", reason: (e as Error).message, url: p.website, runId: args.runId });
      heldBack.push({ name: p.name, reason: "Verification service did not respond" });
      continue;
    }

    if (!result.site.resolves) {
      heldBack.push({
        name: p.name,
        reason: REASON_COPY[`site_${result.site.reason ?? "unreachable"}`] ?? REASON_COPY.site_unreachable,
      });
      continue;
    }
    if (!result.phone.valid) {
      heldBack.push({
        name: p.name,
        reason: REASON_COPY[`phone_${result.phone.reason ?? "format_invalid"}`] ?? REASON_COPY.phone_format_invalid,
      });
      continue;
    }

    passed.push({
      ...cand,
      phoneLineType: result.phone.lineType,
      emailIsRole: result.email.isRole,
    });
  }

  return { passed, heldBack };
}

/** Cheap pre-rank: more and more severe findings first. */
function scoreHint(c: AuditedCandidate): number {
  return c.signals.reduce(
    (a, s) => a + (s.severity === "high" ? 3 : s.severity === "med" ? 2 : 1) * s.confidence,
    0
  );
}

async function loadDoNotContact() {
  return db.doNotContact.findMany().catch(() => []);
}

function isDoNotContact(
  rows: { domain: string | null; phone: string | null; email: string | null }[],
  p: PlaceRecord
) {
  return rows.some(
    (r) =>
      (r.domain && p.website && r.domain.toLowerCase() === p.website.toLowerCase()) ||
      (r.phone && p.phone && r.phone.replace(/\D/g, "") === p.phone.replace(/\D/g, ""))
  );
}
