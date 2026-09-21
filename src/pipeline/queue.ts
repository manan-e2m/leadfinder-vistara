import { executeRun } from "./run";
import { log } from "@/lib/logger";
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

export function enqueue(job: Job) {
  pending.push(job);
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
        drain();
      });
  }
}
