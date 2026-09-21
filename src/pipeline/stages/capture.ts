import { db } from "@/lib/db";
import { normalizeDomain, agencyNameFromDomain } from "@/lib/domain";
import { logFailure } from "@/lib/logger";

/**
 * Stage 1 — Capture. One required field. Dedupe on registrable domain so a
 * second scan from the same agency joins the existing workspace and sees the
 * same results instantly. No login. Budget < 1 s. Plan §5.1
 */

export interface CaptureResult {
  ok: boolean;
  workspaceId?: string;
  domain?: string;
  corrected?: boolean;
  /** true when the attendee joined a workspace a teammate had already created */
  joinedExisting?: boolean;
  teammateCount?: number;
  error?: string;
}

export async function capture(input: {
  url: string;
  city?: string | null;
  radiusMiles?: number | null;
  vertical?: string | null;
  source?: string;
}): Promise<CaptureResult> {
  const norm = normalizeDomain(input.url);

  if (!norm.ok) {
    // Fallback: we ask for the business name plus city rather than erroring.
    await logFailure({ stage: "capture", reason: norm.reason, url: input.url });
    return {
      ok: false,
      error:
        norm.reason === "empty"
          ? "Enter your website to get started."
          : "That doesn't look like a website. Try just the domain, like youragency.com.",
    };
  }

  const existing = await db.workspace.findUnique({
    where: { domain: norm.domain },
    include: { _count: { select: { attendees: true } } },
  });

  if (existing) {
    await db.attendee.create({
      data: { workspaceId: existing.id, source: input.source ?? "teammate" },
    });
    return {
      ok: true,
      workspaceId: existing.id,
      domain: norm.domain,
      corrected: norm.corrected,
      joinedExisting: true,
      teammateCount: existing._count.attendees + 1,
    };
  }

  const ws = await db.workspace.create({
    data: {
      domain: norm.domain,
      agencyName: agencyNameFromDomain(norm.domain),
      attendees: { create: { source: input.source ?? "qr" } },
    },
  });

  return {
    ok: true,
    workspaceId: ws.id,
    domain: norm.domain,
    corrected: norm.corrected,
    joinedExisting: false,
    teammateCount: 1,
  };
}
