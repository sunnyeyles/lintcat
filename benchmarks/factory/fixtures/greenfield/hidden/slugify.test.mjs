import assert from "node:assert/strict";
import test from "node:test";

import { slugify } from "../src/slugify.mjs";

test("lowercases and joins words with single dashes", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  a   b  "), "a-b");
  assert.equal(slugify("Release 2.0 notes"), "release-2-0-notes");
});

test("leaves a slug alone and handles empty input", () => {
  assert.equal(slugify("already-a-slug"), "already-a-slug");
  assert.equal(slugify("--edge--"), "edge");
  assert.equal(slugify(""), "");
});
