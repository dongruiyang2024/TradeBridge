import assert from "node:assert/strict";
import { test } from "node:test";
import { AutoSyncScheduler } from "../src/background/auto-sync-scheduler.js";

// A controllable fake timer: schedule() registers a callback; flush() runs the
// most recently scheduled one. Mirrors setTimeout/clearTimeout semantics enough
// to drive the debounce deterministically without real time.
function createFakeTimer() {
  let nextId = 1;
  const handlers = new Map<number, () => void>();
  return {
    setTimeout(handler: () => void): unknown {
      const id = nextId++;
      handlers.set(id, handler);
      return id;
    },
    clearTimeout(timerId: unknown): void {
      handlers.delete(timerId as number);
    },
    pending(): number {
      return handlers.size;
    },
    async flush(): Promise<void> {
      const entries = [...handlers.entries()];
      handlers.clear();
      for (const [, handler] of entries) handler();
      // Let the async fire() chain settle.
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

test("coalesces a burst of schedule() calls into a single sync", async () => {
  const timer = createFakeTimer();
  let runs = 0;
  const scheduler = new AutoSyncScheduler({
    runSync: async () => {
      runs += 1;
    },
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(timer.pending(), 1, "burst collapses to one pending timer");

  await timer.flush();
  assert.equal(runs, 1, "only one sync runs for the burst");
});

test("queues exactly one follow-up sync for messages arriving mid-sync", async () => {
  const timer = createFakeTimer();
  let runs = 0;
  const releases: Array<() => void> = [];
  const scheduler = new AutoSyncScheduler({
    runSync: () =>
      new Promise<void>((resolve) => {
        runs += 1;
        releases.push(resolve);
      }),
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });

  scheduler.schedule();
  await timer.flush(); // starts the first sync; it is now in flight
  assert.equal(runs, 1);

  // Messages arrive while the first sync is still running.
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(runs, 1, "no new sync starts while one is in flight");

  releases.shift()?.(); // finish the first sync
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timer.pending(), 1, "a single follow-up sync is queued");

  await timer.flush();
  assert.equal(runs, 2, "exactly one follow-up sync runs");
});

test("a failing sync does not kill the scheduler", async () => {
  const timer = createFakeTimer();
  let runs = 0;
  const scheduler = new AutoSyncScheduler({
    runSync: async () => {
      runs += 1;
      throw new Error("sync_failed");
    },
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });

  scheduler.schedule();
  await timer.flush();
  assert.equal(runs, 1);

  // Scheduler still accepts new work after a failure.
  scheduler.schedule();
  await timer.flush();
  assert.equal(runs, 2, "scheduler keeps working after a failed sync");
});

test("runs periodic syncs at a fixed cadence", async () => {
  const timer = createFakeTimer();
  let runs = 0;
  const scheduler = new AutoSyncScheduler({
    runSync: async () => {
      runs += 1;
    },
    periodicIntervalMs: 10_000,
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout
  });

  scheduler.startPeriodic();
  assert.equal(timer.pending(), 1, "one periodic timer is scheduled");

  await timer.flush();
  assert.equal(runs, 1);
  assert.equal(timer.pending(), 1, "next periodic timer is scheduled after the run");
});
