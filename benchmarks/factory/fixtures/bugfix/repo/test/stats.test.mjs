import assert from "node:assert/strict";
import test from "node:test";

import { mean, median } from "../src/stats.mjs";

test("mean", () => {
  assert.equal(mean([1, 2, 3]), 2);
});

test("median of a small odd list", () => {
  assert.equal(median([3, 1, 2]), 2);
});
