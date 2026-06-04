import assert from "node:assert/strict";
import { test } from "node:test";
import { OutboundPacer } from "../src/background/outbound-pacer.js";

// Deterministic clock + injected random/sleep so timing is fully controlled.
function controllable(options: Partial<{ random: number; start: number }> = {}) {
  let clock = options.start ?? 0;
  const slept: number[] = [];
  const pacer = new OutboundPacer({
    minDelayMs: 1000,
    maxDelayMs: 5000,
    maxPerMinute: 3,
    maxPerHour: 5,
    batchBudgetMs: 60_000,
    now: () => clock,
    random: () => options.random ?? 0.5,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    }
  });
  return {
    pacer,
    slept,
    advance: (ms: number) => {
      clock += ms;
    }
  };
}

test("first send in a batch has no delay, subsequent sends are jittered", async () => {
  const { pacer, slept } = controllable({ random: 0.5 });
  pacer.beginBatch();

  const first = pacer.next();
  assert.deepEqual(first, { kind: "send", waitMs: 0 });
  await pacer.waitAndRecord(first.kind === "send" ? first.waitMs : 0);

  const second = pacer.next();
  assert.equal(second.kind, "send");
  // 1000 + 0.5 * (5000-1000) = 3000
  assert.equal(second.kind === "send" ? second.waitMs : -1, 3000);
  await pacer.waitAndRecord(second.kind === "send" ? second.waitMs : 0);

  assert.deepEqual(slept, [3000]);
});

test("jitter spans the configured range with random extremes", async () => {
  const low = controllable({ random: 0 });
  low.pacer.beginBatch();
  await low.pacer.waitAndRecord(0); // first send recorded
  const lowDecision = low.pacer.next();
  assert.equal(lowDecision.kind === "send" ? lowDecision.waitMs : -1, 1000);

  const high = controllable({ random: 1 });
  high.pacer.beginBatch();
  await high.pacer.waitAndRecord(0);
  const highDecision = high.pacer.next();
  assert.equal(highDecision.kind === "send" ? highDecision.waitMs : -1, 5000);
});

test("per-minute cap defers further sends until the window slides", async () => {
  const { pacer, advance } = controllable({ random: 0 });
  pacer.beginBatch();

  // maxPerMinute = 3
  for (let i = 0; i < 3; i += 1) {
    const decision = pacer.next();
    assert.equal(decision.kind, "send", `send ${i} should be allowed`);
    await pacer.waitAndRecord(decision.kind === "send" ? decision.waitMs : 0);
  }

  const blocked = pacer.next();
  assert.deepEqual(blocked, { kind: "defer", reason: "rate_limited" });

  // Slide past the minute window; per-hour cap (5) still has room.
  advance(61_000);
  pacer.beginBatch();
  const afterWindow = pacer.next();
  assert.equal(afterWindow.kind, "send");
});

test("per-hour cap defers sends even when the minute window is clear", async () => {
  const { pacer, advance } = controllable({ random: 0 });

  // Fill the hour cap (5), spacing past each minute window so only the hour cap bites.
  for (let i = 0; i < 5; i += 1) {
    pacer.beginBatch();
    const decision = pacer.next();
    assert.equal(decision.kind, "send", `send ${i} allowed`);
    await pacer.waitAndRecord(decision.kind === "send" ? decision.waitMs : 0);
    advance(61_000);
  }

  pacer.beginBatch();
  const blocked = pacer.next();
  assert.deepEqual(blocked, { kind: "defer", reason: "rate_limited" });
});

test("batch budget defers when the next jittered wait would overrun", async () => {
  let clock = 0;
  const pacer = new OutboundPacer({
    minDelayMs: 40_000,
    maxDelayMs: 40_000,
    maxPerMinute: 100,
    maxPerHour: 100,
    batchBudgetMs: 30_000,
    now: () => clock,
    random: () => 0,
    sleep: async (ms) => {
      clock += ms;
    }
  });
  pacer.beginBatch();

  const first = pacer.next();
  assert.deepEqual(first, { kind: "send", waitMs: 0 });
  await pacer.waitAndRecord(0);

  // Next wait would be 40s, exceeding the 30s batch budget.
  const second = pacer.next();
  assert.deepEqual(second, { kind: "defer", reason: "budget_exhausted" });
});
