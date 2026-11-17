import { describe, expect, it } from "vitest";

import { isTestPath } from "#src/engine/repository";

describe("isTestPath", () => {
  it.each([
    ["src/a.test.ts", true],
    ["pkg/a_test.go", true],
    ["tests/test_a.py", true],
    ["test/helpers.js", true],
    ["src/__fixtures__/input.json", true],
    ["src/a.ts", false],
    ["package.json", false],
    ["src/testing.ts", false],
  ])("%s → %s", (file, expected) => {
    expect(isTestPath(file)).toBe(expected);
  });
});
