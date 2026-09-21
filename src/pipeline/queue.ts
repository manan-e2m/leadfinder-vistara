import { executeRun } from "./run";
import { log } from "@/lib/logger";
import { markRunActive, markRunInactive } from "@/lib/runRecovery";
import type { Icp, BrandAssets } from "@/lib/types";

/**
 * In-process job queue with bounded concurrency.
 *
 * Deliberately simple: one Next.js process, a fixed worker pool, and status
 * read back from the database so the progress screen works across reloads
 * and devices. That is enough for the event itself, where all registered
 * attendees are pre-computed and only walk-ins hit the live pipeline.
 *
 * For the >100 concurrent burst the load test targets in week 17, swap this
 * module for a durable queue (BullMQ + Redis, or a hosted equivalent). The
 * interface below is the whole surface area that would have to change.
 * Plan §5.8, §9.1
 */

const MAX_CONCURRENT = Number(process.env.QUEUE_CONCURRENCY ?? 6);

interface Job {
  runId: string;
  workspaceId: string;
  domain: string;
  icp: Icp;
  brand: BrandAssets;
}

const pending: Job[] = [];
const active = new Set<string>();

/** True when this process already has the run queued or executing. */
export function isQueuedOrActive(runId: string): boolean {
  return active.has(runId) || pending.some((j) => j.runId === runId);
}

export function enqueue(job: Job) {
  // In-process lock: a double-click that lands in the same tick (or a
  // re-click while waiting) must not create a second execution.
  if (isQueuedOrActive(job.runId)) {
    log("warn", "queue", `duplicate enqueue ignored for ${job.runId}`);
    return;
  }
  pending.push(job);
  markRunActive(job.runId);
  log("info", "queue", `enqueued ${job.runId} (${pending.length} waiting, ${active.size} active)`);
  drain();
}

export function queueDepth() {
  return { waiting: pending.length, active: active.size, capacity: MAX_CONCURRENT };
}

function drain() {
  while (active.size < MAX_CONCURRENT && pending.length > 0) {
    const job = pending.shift()!;
    active.add(job.runId);
    void executeRun(job)
      .catch((e) => log("error", "queue", `${job.runId} threw: ${e.message}`))
      .finally(() => {
        active.delete(job.runId);
        markRunInactive(job.runId);
        drain();
      });
  }
}
