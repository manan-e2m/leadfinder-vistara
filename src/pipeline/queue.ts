import { executeRun } from "./run";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { markRunActive, markRunInactive } from "@/lib/runRecovery";
import { packJson } from "@/lib/json";
import type { Icp, BrandAssets } from "@/lib/types";
/** Upsert may miss under a race; losing one persistence row is harmless. */
const persistQueueRow = (runId: string, jobId: string, status: string, icp: Icp, brand: BrandAssets) =>
  db.runQueue
    .upsert({
      where: { runId },
      create: { runId, status, payloadJson: packJson({ icp, brand }) },
      update: { status },
    })
    .catch((e) => log("warn", "queue", `persistence for ${jobId} skipped: ${e.message}`));

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
  void persistQueueRow(job.runId, job.runId, "queued", job.icp, job.brand);
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
    void persistQueueRow(job.runId, job.runId, "running", job.icp, job.brand);
    void executeRun(job)
      .catch((e) => log("error", "queue", `${job.runId} threw: ${e.message}`))
      .finally(() => {
        active.delete(job.runId);
        markRunInactive(job.runId);
        // The run has reached a terminal state here (executeRun's own
        // finally handled failed/crashed paths too), so the persisted
        // queue row is done — kept for audit, not re-enqueued at boot.
        void persistQueueRow(job.runId, job.runId, "done", job.icp, job.brand);
        drain();
      });
  }
}
