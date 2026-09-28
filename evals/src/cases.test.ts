/** Every case's anchors resolve without a model, so a moved marker fails here, not in a paid run. */
import { describe, expect, it } from "vitest";

import { evalCases } from "#src/cases";
import { resolveAnchor, resolveCitation } from "#src/expectations";
import { loadFixture } from "#src/fixture";

describe("evalCases", () => {
  it.each(evalCases.map((evalCase) => [evalCase.fixture, evalCase] as const))(
    "resolves every anchor of %s inside a changed file, and every citation at base",
    (_name, evalCase) => {
      const fixture = loadFixture(evalCase.fixture);

      for (const expectation of evalCase.expectations) {
        if (expectation.kind !== "finding") continue;
        for (const anchor of expectation.anchors) {
          const { from, to } = resolveAnchor(fixture, anchor);
          expect(from).toBeLessThanOrEqual(to);
        }
        for (const citation of expectation.cites ?? []) {
          expect(resolveCitation(fixture, citation).line).toBeGreaterThan(0);
        }
      }
    },
  );

  it.each(evalCases.map((evalCase) => [evalCase.fixture, evalCase] as const))(
    "names only unchanged base files in %s's files-unread expectations",
    (_name, evalCase) => {
      const fixture = loadFixture(evalCase.fixture);
      const changed = new Set(fixture.changedFiles.map((file) => file.filename));

      for (const expectation of evalCase.expectations) {
        if (expectation.kind !== "files-unread") continue;
        for (const file of expectation.files) {
          expect(fixture.baseFiles.has(file), file).toBe(true);
          expect(changed.has(file), file).toBe(false);
        }
      }
    },
  );

  it("keeps a precision fixture that must come back clean", () => {
    expect(
      evalCases.some((evalCase) =>
        evalCase.expectations.some((expectation) => expectation.kind === "no-findings"),
      ),
    ).toBe(true);
  });
});
