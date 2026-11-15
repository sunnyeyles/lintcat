import assert from "node:assert/strict";
import test from "node:test";

import { mean, median } from "../src/stats.mjs";

test("sorts numerically, not as strings", () => {
  assert.equal(median([10, 9, 2]), 9);
  assert.equal(median([100, 25, 3, 7, 50]), 25);
});

test("averages the two middle values of an even list", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([4, 1]), 2.5);
});

test("does not reorder its input", () => {
  const input = [3, 1, 2];
  median(input);
  assert.deepEqual(input, [3, 1, 2]);
});

test("rejects an empty list and keeps mean working", () => {
  assert.throws(() => median([]), RangeError);
  assert.equal(mean([2, 4]), 3);
});
