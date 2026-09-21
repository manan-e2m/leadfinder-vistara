/**
 * Pre-computation. Every registered attendee is run through the full pipeline
 * ahead of the event and the result hand-QA'd, so on the day they get an
 * instant, correct shortlist and never touch the fallback path. This also
 * warms the metro+vertical cache pools, so walk-ins in the same verticals hit
 * warm data too. Plan §6.7, §9.2, §12.1
 *
 *   npm run precompute            # all pending
 *   npm run precompute -- --all   # re-run everything, ignoring status
 *   npm run precompute -- --limit 3
 */
import { PrismaClient } from "@prisma/client";
import { inferIcp } from "@/pipeline/stages/icp";
import { executeRun } from "@/pipeline/run";
import { RunBudget } from "@/lib/cost";
import { normalizeDomain } from "@/lib/domain";
import { packJson } from "@/lib/json";

const db = new PrismaClient();

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? "" : null;
}

async function main() {
  const all = process.argv.includes("--all");
  const limit = Number(arg("limit") ?? "0") || undefined;

  const attendees = await db.registeredAttendee.findMany({
    where: all ? {} : { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  if (attendees.length === 0) {
    console.log("Nothing to precompute. (Use --all to re-run everything.)");
    return;
  }

  console.log(`Precomputing ${attendees.length} attendee(s)…\n`);

  for (const a of attendees) {
    const norm = normalizeDomain(a.website);
    const domain = norm.ok ? norm.domain : a.website;
    process.stdout.write(`• ${a.agencyName} (${domain}) … `);
    try {
      const workspace = await db.workspace.upsert({
        where: { domain },
        update: { agencyName: a.agencyName },
        create: { domain, agencyName: a.agencyName },
      });

      // Create the run first so ICP-inference cost charges to a real row.
      const run = await db.run.create({
        data: { workspaceId: workspace.id, status: "queued", mode: "precomputed" },
      });

      const budget = new RunBudget(run.id);
      const { icp, brand } = await inferIcp({ domain, agencyName: a.agencyName, budget });

      await db.workspace.update({
        where: { id: workspace.id },
        data: { icpJson: packJson(icp), brandJson: packJson(brand) },
      });

      // Run inline (not via the in-process queue) so the script blocks until
      // each attendee is fully computed and its cache pool is warm.
      await executeRun({ runId: run.id, workspaceId: workspace.id, domain, icp, brand });

      const finished = await db.run.findUnique({ where: { id: run.id } });
      await db.registeredAttendee.update({
        where: { id: a.id },
        data: {
          status: finished?.status === "failed" ? "failed" : "precomputed",
          precomputedAt: new Date(),
          workspaceId: workspace.id,
        },
      });
      console.log(`${finished?.leadCount ?? 0} leads · ${finished?.status ?? "?"} · ${finished?.costCents ?? 0}c`);
    } catch (e) {
      await db.registeredAttendee.update({
        where: { id: a.id },
        data: { status: "failed", qaNote: (e as Error).message.slice(0, 300) },
      });
      console.log(`FAILED — ${(e as Error).message}`);
    }
  }

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
