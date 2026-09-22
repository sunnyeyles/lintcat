/**
 * The review evaluation suite: real pipeline, real model. Costs tokens and is
 * non-deterministic, so it runs on demand with `pnpm eval`, not `pnpm test`.
 */
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createConsoleLogger } from "@pr-review/logging";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { evalCases } from "#src/cases";
import { evaluateExpectation } from "#src/expectations";
import { indexEnabled } from "#src/fixture-client";
import { loadFixture } from "#src/fixture";
import { requireModelAccess } from "#src/model-access";
import {
  modelBackedDeps,
  runFixtureReview,
  type FixtureReview,
} from "#src/run-fixture-review";
import {
  createUsageCollector,
  renderUsageTable,
  sumRows,
  writeUsageReport,
} from "#src/usage-report";

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "results");

const access = requireModelAccess(process.env);
const collector = createUsageCollector(access.model);
const startedAt = new Date().toISOString();
// A full review takes minutes, and silence looks like a hang.
const deps = modelBackedDeps(access, createConsoleLogger(), collector.onUsage);

for (const evalCase of evalCases) {
  const fixture = loadFixture(evalCase.fixture);

  describe(`${fixture.name} — ${fixture.title}`, () => {
    let review: FixtureReview;

    beforeAll(async () => {
      collector.begin(fixture.name);
      review = await runFixtureReview(fixture, deps);
    });

    for (const expectation of evalCase.expectations) {
      test(expectation.description, () => {
        const outcome = evaluateExpectation(review, expectation);
        collector.record(fixture.name, outcome.passed);
        expect(
          outcome.passed,
          `FIXTURE ${fixture.name}\nEXPECTATION ${expectation.description}\n\n${outcome.detail}`,
        ).toBe(true);
      });
    }
  });
}

afterAll(() => {
  const rows = collector.rows();
  const report = {
    provider: access.provider,
    model: access.model,
    indexMode: indexEnabled(process.env) ? ("on" as const) : ("off" as const),
    startedAt,
    rows,
    totals: sumRows(rows, access.model),
  };
  const path = writeUsageReport(RESULTS_DIR, report);
  console.log(`\n${renderUsageTable(report)}\n\nwritten to ${path}\n`);
});
