import assert from "node:assert/strict";
import test from "node:test";

import { greet } from "../src/greet.mjs";

test("plain greeting is unchanged", () => {
  assert.equal(greet("Ada"), "Hello, Ada");
  assert.equal(greet("Grace", {}), "Hello, Grace");
});

test("excited adds one exclamation mark", () => {
  assert.equal(greet("Ada", { excited: true }), "Hello, Ada!");
  assert.equal(greet("Ada", { excited: false }), "Hello, Ada");
});
