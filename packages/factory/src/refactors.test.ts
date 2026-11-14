import { describe, expect, it } from "vitest";

import { MAX_REFACTORS, refactorOutcome, renderRefactors, validateRefactors } from "#src/refactors";

const suggestion = { title: "Extract greeting", files: ["src/greet.js"], rationale: "the literal is duplicated" };

describe("validateRefactors", () => {
  it("drops unsafe paths, empty fields and duplicates", () => {
    const result = validateRefactors([
      { ...suggestion, files: ["src/greet.js", "src/greet.js", "/etc/passwd", "../outside.js"] },
      { ...suggestion, title: "  " },
      { ...suggestion, files: ["../x.js"] },
    ]);
    expect(result).toEqual([suggestion]);
  });

  it(`keeps at most ${MAX_REFACTORS}`, () => {
    expect(validateRefactors(Array.from({ length: 5 }, () => suggestion))).toHaveLength(MAX_REFACTORS);
  });
});

describe("rendering", () => {
  it("lists each suggestion with its files", () => {
    expect(renderRefactors([suggestion])).toEqual(["- **Extract greeting** (`src/greet.js`): the literal is duplicated"]);
  });

  it("builds a follow-up outcome", () => {
    expect(refactorOutcome(suggestion)).toBe("Refactor: Extract greeting. Files: src/greet.js. Why: the literal is duplicated");
  });
});
