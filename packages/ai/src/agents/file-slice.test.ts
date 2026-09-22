import { describe, expect, it } from "vitest";

import { sliceLines } from "#src/agents/file-slice";

const file = ["one", "two", "three", "four", "five"].join("\n");

describe("sliceLines", () => {
  it("returns the file untouched when no range is asked for", () => {
    expect(sliceLines(file)).toBe(file);
    expect(sliceLines(file, {})).toBe(file);
  });

  it("returns the inclusive range under a header saying where it sits", () => {
    expect(sliceLines(file, { startLine: 2, endLine: 4 })).toBe(
      "[lines 2-4 of 5]\ntwo\nthree\nfour",
    );
  });

  it("runs to the end when only a start is given, and from the top when only an end is", () => {
    expect(sliceLines(file, { startLine: 4 })).toBe("[lines 4-5 of 5]\nfour\nfive");
    expect(sliceLines(file, { endLine: 2 })).toBe("[lines 1-2 of 5]\none\ntwo");
  });

  it("clamps a range that runs past the file", () => {
    expect(sliceLines(file, { startLine: 4, endLine: 40 })).toBe(
      "[lines 4-5 of 5]\nfour\nfive",
    );
  });

  it("returns the last line when the start is past the file", () => {
    expect(sliceLines(file, { startLine: 9, endLine: 12 })).toBe("[lines 5-5 of 5]\nfive");
  });
});
