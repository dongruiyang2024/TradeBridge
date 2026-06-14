// Debounces inbound-triggered syncs and owns the local periodic sync cadence.
// New OneTalk messages still coalesce through schedule(); startPeriodic() adds a
// short fixed backstop for local testing where we want uploads every 10 seconds.

export interface AutoSyncSchedulerOptions {
  // Runs one full sync (+ outbound). Must not throw to the caller; its result
  // is ignored here — failures surface through the sync status it persists.
  runSync(): Promise<unknown>;
  delayMs?: number;
  periodicIntervalMs?: number;
  setTimeout?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeout?: (timerId: unknown) => void;
}

const DEFAULT_DELAY_MS = 2_000;

export class AutoSyncScheduler {
  private readonly runSync: () => Promise<unknown>;
  private readonly delayMs: number;
  private readonly periodicIntervalMs: number | null;
  private readonly setTimeoutFn: (handler: () => void, timeoutMs: number) => unknown;
  private readonly clearTimeoutFn: (timerId: unknown) => void;

  private timerId: unknown = null;
  private periodicTimerId: unknown = null;
  // A sync is currently running. Further schedule() calls during a run set
  // pending so we sync again once the in-flight run finishes — messages that
  // arrived mid-sync are not lost.
  private running = false;
  private pending = false;

  constructor(options: AutoSyncSchedulerOptions) {
    this.runSync = options.runSync;
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.periodicIntervalMs = options.periodicIntervalMs ?? null;
    this.setTimeoutFn = options.setTimeout || ((handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs));
    this.clearTimeoutFn = options.clearTimeout || ((timerId) => globalThis.clearTimeout(timerId as never));
  }

  // Request a sync soon. Repeated calls within the debounce window collapse
  // into one. Calls while a sync is in flight queue exactly one follow-up run.
  schedule(): void {
    if (this.running) {
      this.pending = true;
      return;
    }
    if (this.timerId != null) this.clearTimeoutFn(this.timerId);
    this.timerId = this.setTimeoutFn(() => {
      this.timerId = null;
      void this.fire();
    }, this.delayMs);
  }

  startPeriodic(): void {
    if (this.periodicIntervalMs == null) return;
    if (this.periodicTimerId != null) this.clearTimeoutFn(this.periodicTimerId);
    this.periodicTimerId = this.setTimeoutFn(() => {
      this.periodicTimerId = null;
      void this.fire().finally(() => this.startPeriodic());
    }, this.periodicIntervalMs);
  }

  stopPeriodic(): void {
    if (this.periodicTimerId == null) return;
    this.clearTimeoutFn(this.periodicTimerId);
    this.periodicTimerId = null;
  }

  private async fire(): Promise<void> {
    this.running = true;
    this.pending = false;
    try {
      await this.runSync();
    } catch {
      // runSync owns its own error reporting; swallow so the scheduler stays alive.
    } finally {
      this.running = false;
      if (this.pending) this.schedule();
    }
  }
}
