// Paces outbound message delivery so it does not look like an automated burst.
//
// Two controls, both applied in the single delivery funnel
// (sendOutboundMessagesViaOneTalk):
//   1. Jittered inter-message delay — a randomized wait between sends so the
//      cadence never lands on a fixed interval (a machine tell).
//   2. Sliding-window rate cap — a hard ceiling on sends per minute and per
//      hour for one account.
//
// A per-batch time budget keeps any single service-worker invocation short:
// once the budget is spent, remaining messages are left for the next
// alarm/claim cycle rather than sleeping for minutes (the worker can be
// evicted mid-sleep).

export interface OutboundPacerOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  maxPerMinute?: number;
  maxPerHour?: number;
  batchBudgetMs?: number;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type PacerDecision = { kind: "send"; waitMs: number } | { kind: "defer"; reason: "rate_limited" | "budget_exhausted" };

const DEFAULT_MIN_DELAY_MS = 3_000;
const DEFAULT_MAX_DELAY_MS = 15_000;
const DEFAULT_MAX_PER_MINUTE = 8;
const DEFAULT_MAX_PER_HOUR = 60;
const DEFAULT_BATCH_BUDGET_MS = 60_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export class OutboundPacer {
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxPerMinute: number;
  private readonly maxPerHour: number;
  private readonly batchBudgetMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  // Send timestamps within the trailing hour, used for both windows.
  private sendTimes: number[] = [];
  private batchStart: number | null = null;
  private isFirstInBatch = true;

  constructor(options: OutboundPacerOptions = {}) {
    this.minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.maxPerMinute = options.maxPerMinute ?? DEFAULT_MAX_PER_MINUTE;
    this.maxPerHour = options.maxPerHour ?? DEFAULT_MAX_PER_HOUR;
    this.batchBudgetMs = options.batchBudgetMs ?? DEFAULT_BATCH_BUDGET_MS;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // Call once before delivering a batch.
  beginBatch(): void {
    this.batchStart = this.now();
    this.isFirstInBatch = true;
  }

  // Decide whether the next message may be sent now. Returns the jittered wait
  // applied before sending, or a defer reason when a cap/budget blocks it.
  // Callers should stop delivering this batch on any "defer".
  next(): PacerDecision {
    const at = this.now();
    this.pruneOlderThan(at - HOUR_MS);

    if (this.countSince(at - MINUTE_MS) >= this.maxPerMinute) {
      return { kind: "defer", reason: "rate_limited" };
    }
    if (this.countSince(at - HOUR_MS) >= this.maxPerHour) {
      return { kind: "defer", reason: "rate_limited" };
    }

    const waitMs = this.isFirstInBatch ? 0 : this.jitter();
    if (!this.isFirstInBatch && this.batchStart !== null && at - this.batchStart + waitMs > this.batchBudgetMs) {
      return { kind: "defer", reason: "budget_exhausted" };
    }
    return { kind: "send", waitMs };
  }

  // Wait the decided amount, then record the send. Call only after next()
  // returns { kind: "send" } and you are about to send.
  async waitAndRecord(waitMs: number): Promise<void> {
    if (waitMs > 0) await this.sleep(waitMs);
    this.sendTimes.push(this.now());
    this.isFirstInBatch = false;
  }

  private jitter(): number {
    const span = Math.max(0, this.maxDelayMs - this.minDelayMs);
    return Math.round(this.minDelayMs + this.random() * span);
  }

  private countSince(threshold: number): number {
    let count = 0;
    for (const time of this.sendTimes) if (time > threshold) count += 1;
    return count;
  }

  private pruneOlderThan(threshold: number): void {
    if (!this.sendTimes.length) return;
    this.sendTimes = this.sendTimes.filter((time) => time > threshold);
  }
}
