import { db } from "./db";

type Level = "info" | "warn" | "error";

const stamp = () => new Date().toISOString().slice(11, 23);

export function log(level: Level, scope: string, msg: string, meta?: unknown) {
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (level === "error") console.error(line, meta ?? "");
  else if (level === "warn") console.warn(line, meta ?? "");
  else console.log(line, meta ?? "");
}

/**
 * Every failure is logged with the URL, the stage and the reason. That list
 * is the spec for the production version and a concrete thing to reference
 * in follow-up conversations. Plan §6.8
 */
export async function logFailure(args: {
  stage: string;
  reason: string;
  url?: string | null;
  runId?: string | null;
}) {
  log("warn", args.stage, args.reason, args.url ?? undefined);
  try {
    await db.failureLog.create({
      data: {
        stage: args.stage,
        reason: args.reason.slice(0, 500),
        url: args.url ?? null,
        runId: args.runId ?? null,
      },
    });
  } catch {
    /* logging must never break a run */
  }
}
