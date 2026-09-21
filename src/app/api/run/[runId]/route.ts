import { NextResponse } from "next/server";
import { getRunResults } from "@/lib/results";
import { rawRunForLinkGuard, isLinkExpired } from "@/lib/linkGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const view = await getRunResults(runId);
  if (!view) return NextResponse.json({ error: "run_not_found" }, { status: 404 });

  /* Opt-in expiry guard: only active when RESULT_LINK_TTL_HOURS > 0. */
  const raw = await rawRunForLinkGuard(runId);
  if (raw && isLinkExpired(raw)) {
    return NextResponse.json({ error: "link_expired" }, { status: 410 });
  }

  return NextResponse.json(view);
}
