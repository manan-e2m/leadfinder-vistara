import { db } from "./db";
import { env } from "./env";
import { log } from "./logger";

/**
 * A hard per-run budget, set before the first line of pipeline code and
 * enforced in the worker. One enthusiastic attendee re-running twelve times
 * must not distort the bill or starve other jobs. Plan §9.3
 */

/** Indicative unit prices in US cents. Tune against real invoices. */
export const UNIT_COST_CENTS: Record<string, number> = {
  "places.nearby": 3.2,
  "places.details": 1.7,
  "pagespeed.run": 0.0,
  "adlibrary.lookup": 0.0,
  "techdetect.fetch": 0.05,
  "gbp.lookup": 0.4,
  "apollo.search": 2.5,
  "verify.phone": 0.8,
  "verify.email": 0.2,
  "llm.opener": 0.9,
  "llm.icp": 1.4,
  "render.headless": 0.6,
};

export class CostCapExceeded extends Error {
  constructor(public spent: number, public cap: number) {
    super(`per-run cost cap reached: ${spent.toFixed(2)}c of ${cap}c`);
    this.name = "CostCapExceeded";
  }
}

export class RunBudget {
  private spent = 0;
  private capped = false;

  constructor(private runId: string, private capCents = env.costCapCents) {}

  get spentCents() { return this.spent; }
  get isCapped() { return this.capped; }
  get remaining() { return Math.max(0, this.capCents - this.spent); }

  /**
   * Per-run guard: keeps an enthusiastic loop from distorting the BILL, but
   * per user request (2026-09-21) it never degrades a run anymore — the cap
   * is tracked and recorded for the bill, and the user-facing "cost cap"
   * messaging is gone. `costCapCents = 0` disables the cap entirely.
   */

  /** True when there is room for this op. Callers degrade rather than throw. */
  canAfford(op: string, units = 1): boolean {
    if (this.capCents <= 0) return true; // cap disabled
    const cost = (UNIT_COST_CENTS[op] ?? 0) * units;
    return this.spent + cost <= this.capCents;
  }

  /** Record spend. Returns false once the cap is hit so the caller degrades. */
  async charge(op: string, units = 1, provider = "unknown"): Promise<boolean> {
    // Mock mode spends nothing real — charging real unit costs against the
    // cap made demos degrade into template openers mid-audit (340 pool
    // audits burn the 45c cap fast) for money that was never spent.
    if (env.providerMode === "mock") return true;
    if (this.capCents <= 0) {
      // Cap disabled: record spend for the bill, never restrict.
      const cents = (UNIT_COST_CENTS[op] ?? 0) * units;
      this.spent += cents;
      return true;
    }
    const cents = (UNIT_COST_CENTS[op] ?? 0) * units;
    if (this.spent + cents > this.capCents) {
      if (!this.capped) {
        this.capped = true;
        log("warn", "cost", `run ${this.runId} hit the ${this.capCents}c cap — degrading`);
        await db.run.update({
          where: { id: this.runId },
          data: { cappedAt: new Date() },
        }).catch(() => {});
      }
      return false;
    }
    this.spent += cents;
    if (cents > 0) {
      await db.costLedger.create({
        data: { runId: this.runId, provider, op, units, cents },
      }).catch(() => {});
    }
    return true;
  }

  async flush() {
    await db.run.update({
      where: { id: this.runId },
      data: { costCents: Number(this.spent.toFixed(3)) },
    }).catch(() => {});
  }
}
