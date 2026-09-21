/**
 * The review evaluation suite: real pipeline, real model. Costs tokens and is
 * non-deterministic, so it runs on demand with `pnpm eval`, not `pnpm test`.
 */
import process from "node:process";

import { createConsoleLogger } from "@pr-review/logging";
import { beforeAll, describe, expect, test } from "vitest";

import { evalCases } from "#src/cases";
import { evaluateExpectation } from "#src/expectations";
import { loadFixture } from "#src/fixture";
import { requireModelAccess } from "#src/model-access";
import {
  modelBackedDeps,
  runFixtureReview,
  type FixtureReview,
} from "#src/run-fixture-review";

// A full review takes minutes, and silence looks like a hang.
const deps = modelBackedDeps(requireModelAccess(process.env), createConsoleLogger());

for (const evalCase of evalCases) {
  const fixture = loadFixture(evalCase.fixture);

  describe(`${fixture.name} — ${fixture.title}`, () => {
    let review: FixtureReview;

    beforeAll(async () => {
      review = await runFixtureReview(fixture, deps);
    });

    for (const expectation of evalCase.expectations) {
      test(expectation.description, () => {
        const outcome = evaluateExpectation(review, expectation);
        expect(
          outcome.passed,
          `FIXTURE ${fixture.name}\nEXPECTATION ${expectation.description}\n\n${outcome.detail}`,
        ).toBe(true);
      });
    }
  });
}
