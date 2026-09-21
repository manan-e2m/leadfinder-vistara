/**
 * In-process smoke test — pre-demo readiness check.
 *
 * Boots NOTHING: no server, no spawned process. It imports the pipeline
 * directly, forces providerMode to "mock" (before importing anything that
 * reads env), picks a seeded test agency, and pushes a scan → start →
 * pipeline E2E through to completion in this very process.
 *
 * Usage: npm run smoke   (= PROVIDER_MODE=mock tsx scripts/smoke.ts)
 * Exit code 0 = PASS, 1 = FAIL. Prints a one-line summary a human can
 * read ten minutes before doors open.
 */
(process.env.PROVIDER_MODE ||= "mock");
(process.env.DATABASE_URL ||= "file:./dev.db");

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const CHECK: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: string) {
  CHECK.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log("\nLeadFinder smoke test (mock providers, in-process)\n");

  /* 1. DB reachable — push schema first if the tables are missing. */
  try {
    await db.$queryRaw`SELECT 1 FROM "Run" LIMIT 1`;
    check("database reachable", true);
  } catch {
    console.log("  · tables missing — running prisma db push…");
    const { execSync } = await import("node:child_process");
    execSync("npx prisma db push --skip-generate", { stdio: "inherit" });
    await db.$queryRaw`SELECT 1 FROM "Run" LIMIT 1`;
    check("database reachable", true, "schema pushed by smoke script");
  }

  /* 2. A test agency — from the seed fixtures when present, else synthesized. */
  const seeded = await db.registeredAttendee.findFirst({
    where: { status: { in: ["pending", "precomputed", "qa_passed"] } },
  });
  const input = seeded?.website ?? "smoketestagency.com";
  const agencyName = seeded?.agencyName ?? "Smoke Test Agency";
  check("test agency picked", true, `${agencyName} (${seeded ? "seed fixture" : "synthesised"})`);

  /* 3. Scan: infer ICP in-process, exactly like /api/scan does. */
  const { normalizeDomain, agencyNameFromDomain } = await import("@/lib/domain");
  const { inferIcp } = await import("@/pipeline/stages/icp");
  const { packJson } = await import("@/lib/json");
  const { RunBudget } = await import("@/lib/cost");
  const { enqueue } = await import("@/pipeline/queue");
  const { resetLlmBudget } = await import("@/providers");

  const norm = normalizeDomain(input);
  if (!norm.ok) throw new Error(`could not normalize test domain ${input}`);
  const domain = norm.domain;

  const scanBudget = new RunBudget("smoke-scan");
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => {
    unhandled.push(e);
  };
  process.on("unhandledRejection", onUnhandled);
  let inferred: Awaited<ReturnType<typeof inferIcp>>;
  try {
    inferred = await inferIcp({ domain, agencyName: seeded?.agencyName ?? agencyNameFromDomain(domain), budget: scanBudget });
    await scanBudget.flush();
    check("scan (ICP inference) completed", true, `${inferred.icp.metro || "?"}, ${inferred.icp.targetVerticals.value || "?"}`);
  } catch (e) {
    check("scan (ICP inference) completed", false, (e as Error).message);
    throw e;
  }

  /* 4. Persist workspace + run, enqueue the seven-stage pipeline in-process. */
  const workspace = await db.workspace.upsert({
    where: { domain },
    update: {},
    create: { domain, agencyName: seeded?.agencyName ?? agencyName },
  });
  await db.workspace.update({
    where: { id: workspace.id },
    data: { icpJson: packJson(inferred.icp), brandJson: packJson(inferred.brand) },
  });
  const run = await db.run.create({ data: { workspaceId: workspace.id, status: "queued", mode: "live" } });

  const TIMEOUT_MS = 120_000;
  try {
    await new Promise<void>((resolve, reject) => {
      resetLlmBudget();
      enqueue({
        runId: run.id,
        workspaceId: workspace.id,
        domain,
        icp: inferred.icp,
        brand: inferred.brand,
      });
      const started = Date.now();
      const timer = setInterval(async () => {
        const row = await db.run.findUnique({ where: { id: run.id } });
        if (row && ["complete", "degraded"].includes(row.status)) {
          clearInterval(timer);
          resolve();
        } else if (row && row.status === "failed") {
          clearInterval(timer);
          reject(new Error("run finished as failed"));
        } else if (Date.now() - started > TIMEOUT_MS) {
          clearInterval(timer);
          reject(new Error(`run did not finish within ${TIMEOUT_MS / 1000}s`));
        }
      }, 1000);
    });
    check(`pipeline reached a terminal state within ${TIMEOUT_MS / 1000}s`, true, run.id);
  } catch (e) {
    check(`pipeline reached a terminal state within ${TIMEOUT_MS / 1000}s`, false, (e as Error).message);
  }

  /* 5. Assert the run's outputs. */
  const final = await db.run.findUnique({
    where: { id: run.id },
    include: { leads: true, stageLogs: true },
  });
  check(
    "run status is complete or degraded",
    Boolean(final && ["complete", "degraded"].includes(final.status)),
    final?.status
  );
  check("run produced ≥ 1 lead", Boolean(final && final.leads.length >= 1), `${final?.leads.length ?? 0} leads`);
  const failedStages = final?.stageLogs.filter((s) => s.status === "failed") ?? [];
  check(
    "no unhandled stage failures",
    failedStages.length === 0,
    failedStages.length
      ? failedStages.map((s) => `${s.stage}: ${s.reason ?? ""}`).join("; ")
      : undefined
  );
  check("no unhandled rejections", unhandled.length === 0);
  process.off("unhandledRejection", onUnhandled);

  /* Summary — one line a human can read before doors open. */
  const allOk = CHECK.every((c) => c.ok);
  const failedNames = CHECK.filter((c) => !c.ok).map((c) => c.name).join(", ");
  console.log(
    allOk
      ? `\n${"─".repeat(50)}\nSMOKE PASS — mock pipeline is demo-ready. (${CHECK.length} checks, ${final?.leads.length} leads)\n`
      : `\n${"─".repeat(50)}\nSMOKE FAIL — ${failedNames}\n`
  );
  process.exitCode = allOk ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(`\nSMOKE FAIL — ${e.message}\n${"─".repeat(50)}`);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
