/** Every case's anchors resolve without a model, so a moved marker fails here, not in a paid run. */
import { describe, expect, it } from "vitest";

import { evalCases } from "#src/cases";
import { resolveAnchor } from "#src/expectations";
import { loadFixture } from "#src/fixture";

describe("evalCases", () => {
  it.each(evalCases.map((evalCase) => [evalCase.fixture, evalCase] as const))(
    "resolves every anchor of %s inside a changed file",
    (_name, evalCase) => {
      const fixture = loadFixture(evalCase.fixture);

      for (const expectation of evalCase.expectations) {
        if (expectation.kind !== "finding") continue;
        for (const anchor of expectation.anchors) {
          const { from, to } = resolveAnchor(fixture, anchor);
          expect(from).toBeLessThanOrEqual(to);
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
