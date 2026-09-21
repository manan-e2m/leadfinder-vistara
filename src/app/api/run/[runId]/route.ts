import { NextResponse } from "next/server";
import { getRunResults } from "@/lib/results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const view = await getRunResults(runId);
  if (!view) return NextResponse.json({ error: "run_not_found" }, { status: 404 });
  return NextResponse.json(view);
}
