import { test } from "node:test";
import assert from "node:assert/strict";
import { addUsage, allocate, chunk, clamp, countStances, emptyUsage, mapLimit } from "../src/util.ts";

test("allocate sums to total and respects weights", () => {
  assert.deepEqual(allocate(10, [50, 30, 20]), [5, 3, 2]);
  assert.equal(allocate(7, [1, 1, 1]).reduce((a, b) => a + b), 7);
  assert.deepEqual(allocate(3, [0, 0]), [2, 1]);
});

test("mapLimit keeps order and caps concurrency", async () => {
  let inFlight = 0, peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test("chunk, clamp, countStances", () => {
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
  assert.equal(clamp(5, -1, 1), 1);
  assert.equal(clamp(NaN, -1, 1), 0);
  assert.deepEqual(countStances([{ stance: "yes" }, { stance: "no" }, { stance: "yes" }]), { yes: 2, maybe: 0, no: 1 });
});

test("addUsage prices by model and goes null for unknown models", () => {
  const u = emptyUsage();
  addUsage(u, "claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000 });
  assert.equal(u.calls, 1);
  assert.ok(Math.abs(u.costUsd! - (4 + 2 + 0.4)) < 1e-9);
  addUsage(u, "some-future-model", { input_tokens: 10, output_tokens: 10 });
  assert.equal(u.costUsd, null);
  assert.equal(u.inputTokens, 1_000_010);
});
