import { llm } from "@/providers";
import type { BrandAssets, Icp, DetectedSignal } from "@/lib/types";
import type { ScoredLead } from "./score";
import type { RunBudget } from "@/lib/cost";

/**
 * Stage 7 — Personalization. One email opener and one phone opener per lead.
 * Not fifty variants. Each cites the specific finding, and the tone is
 * calibrated to the agency's own site copy so the opener sounds like them.
 *
 * Plus a one-page white-labeled audit per lead carrying the agency's logo
 * and colours — the platform does the work, the agency's name goes on it.
 * Plan §5.6
 *
 * The tool DRAFTS. It never sends. That line is what keeps the product clear
 * of TCPA and CAN-SPAM at the event, and it is not a limitation to be
 * engineered away later. Plan §3.5, §10
 */

export interface Personalized {
  emailSubject: string;
  emailBody: string;
  phoneOpener: string;
  origin: "llm" | "template";
  auditFindings: { label: string; measurement: string }[];
  auditPlan: string;
}

export async function personalize(args: {
  lead: ScoredLead;
  icp: Icp;
  brand: BrandAssets;
  budget: RunBudget;
}): Promise<Personalized> {
  const { lead, brand, budget } = args;
  const name = lead.candidate.place.name;
  const signals = lead.candidate.signals;
  const top = signals.slice(0, 3);

  const fallback = templateOpener(name, top, brand);

  // Budget exhausted → template opener referencing the top gap. Slightly
  // less specific, never absent. App. C
  if (!budget.canAfford("llm.opener")) {
    return { ...fallback, origin: "template", ...auditParts(top) };
  }

  const { value, origin } = await llm.json<{ subject: string; body: string; phone: string }>({
    system:
      `You write first-touch prospecting openers for a marketing agency called ${brand.agencyName}. ` +
      `Their tone is ${brand.tone}. Write as that agency, to a prospect. ` +
      `Cite the specific measured finding, never a generic claim. No flattery, no "I hope this finds you well", ` +
      `no fake urgency. Two or three short paragraphs maximum for the email, two sentences for the phone opener. ` +
      `Keys: subject, body, phone.`,
    prompt:
      `Prospect: ${name}${lead.candidate.place.city ? ` in ${lead.candidate.place.city}` : ""}.\n` +
      `Measured findings:\n` +
      top.map((s) => `- ${s.label}: ${s.measurement} (source: ${s.source})`).join("\n") +
      `\nWhat ${brand.agencyName} would pitch: ${[...new Set(top.map((s) => s.pitch))].join(", ")}.`,
    maxTokens: 900,
    fallback: { subject: fallback.emailSubject, body: fallback.emailBody, phone: fallback.phoneOpener },
  });

  await budget.charge("llm.opener", 1, "llm");

  return {
    emailSubject: value.subject,
    emailBody: value.body,
    phoneOpener: value.phone,
    origin,
    ...auditParts(top),
  };
}

function auditParts(top: DetectedSignal[]) {
  return {
    auditFindings: top.map((s) => ({ label: s.label, measurement: s.measurement })),
    auditPlan:
      top.length === 0
        ? "A short discovery call to confirm priorities."
        : `A scoped engagement covering ${[...new Set(top.map((s) => s.pitch.toLowerCase()))].join(" and ")}.`,
  };
}

/**
 * The template path. Deliberately good, not a stub: on a bad night at the
 * venue this is what every attendee reads, so it has to stand on its own.
 */
function templateOpener(name: string, top: DetectedSignal[], brand: BrandAssets) {
  const first = top[0];
  if (!first) {
    return {
      emailSubject: `A quick look at ${name}`,
      emailBody:
        `I ran a short audit of ${name}'s web presence this week and pulled together what I found.\n\n` +
        `Happy to send the one-pager over. Worth ten minutes?`,
      phoneOpener: `Hi, I ran a quick audit of ${name}'s website and Google presence. Is now a bad time to share what came up?`,
    };
  }

  const second = top[1];
  return {
    emailSubject: subjectFor(first),
    emailBody:
      `${first.label.replace(/^./, (c) => c.toLowerCase())}. Specifically, ${first.measurement.toLowerCase()}.\n\n` +
      (second ? `${second.label} as well: ${second.measurement.toLowerCase()}.\n\n` : "") +
      `I put together a one-page breakdown with the numbers behind each of these. Worth ten minutes?`,
    phoneOpener:
      `Hi, I was looking at ${name}'s site and noticed ${first.measurement.toLowerCase()}. ` +
      `Is that something anyone's looking after right now?`,
  };
}

function subjectFor(s: DetectedSignal): string {
  const byKey: Record<string, string> = {
    "web.ssl_expired": "Your site is showing a security warning to every visitor",
    "web.broken_form": "Your contact form has been failing silently",
    "web.not_responsive": "Your booking form doesn't work on a phone",
    "seo.stale_reviews": "Your Google profile has gone quiet",
    "seo.absent_local_pack": "You're not in the top three for your core terms",
    "ppc.losing_share": "Competitors are bidding on your terms. You're not.",
    "ppc.untracked_spend": "Ads running, no tracking to measure them",
    "content.stale_blog": "Your content engine stopped",
    "ecom.no_product_schema": "Your products aren't eligible for rich results",
    "ai.no_review_responses": "Reviews coming in, none answered",
  };
  return byKey[s.key] ?? s.label;
}
