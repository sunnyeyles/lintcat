/**
 * The harness's own unit tests: scripted agents, no model, no token spend.
 */
import { createCapturingLogger, type StructuredLogger } from "@pr-review/logging";
import type { RepositoryIndex } from "@pr-review/index";
import { describe, expect, test } from "vitest";

import { repositoryAgent } from "../../packages/ai/src/agent-test-support.js";
import { evalCases } from "./cases.js";
import { resolveAnchor } from "./expectations.js";
import { loadFixture } from "./fixture.js";
import {
  fixtureIndex,
  runFixtureReview,
  type FixtureReviewDeps,
} from "./run-fixture-review.js";

const FIXTURE = "correctness-cross-file-caller";

/** Agents that reach no model: the review still runs end to end and finds nothing. */
function scriptedDeps(
  logger: StructuredLogger,
  indexes: (RepositoryIndex | undefined)[],
): FixtureReviewDeps {
  return {
    agents: [repositoryAgent("correctness")],
    createAgents: (_github, _logger, activeAgents, index) => {
      indexes.push(index);
      return activeAgents.map((agent) => ({
        name: agent.category,
        run: async () => [],
      }));
    },
    synthesiser: {
      synthesise: async () => {
        throw new Error("no candidates, so the synthesiser must never run");
      },
    },
    logger,
  };
}

describe(FIXTURE, () => {
  const fixture = loadFixture(FIXTURE);

  test("the pull request changes the contract but not its cross-file caller", () => {
    expect(fixture.changedFiles.map((file) => file.filename)).toEqual([
      "src/pricing/discount.ts",
      "src/pricing/quote.ts",
    ]);
    expect(fixture.baseFiles.get("src/pricing/discount.ts")).toContain(
      "): number {",
    );
    expect(fixture.headFiles.get("src/pricing/discount.ts")).toContain(
      "): DiscountResult {",
    );
    const caller = fixture.headFiles.get("src/checkout/summary.ts");
    expect(caller).toContain("applyDiscount(subtotal, cart.discountCode)");
    expect(fixture.baseFiles.get("src/checkout/summary.ts")).toBe(caller);
  });

  test("every anchor resolves to exactly one line of a changed file", () => {
    const evalCase = evalCases.find((entry) => entry.fixture === FIXTURE);
    expect(evalCase).toBeDefined();
    const anchors = (evalCase?.expectations ?? []).flatMap((expectation) =>
      expectation.kind === "finding" ? expectation.anchors : [],
    );
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      const contents = fixture.headFiles.get(anchor.file) ?? "";
      const hits = contents
        .split("\n")
        .filter((line) => line.includes(anchor.startMarker));
      expect(hits, `${anchor.file}: ${anchor.startMarker}`).toHaveLength(1);
      const resolved = resolveAnchor(fixture, anchor);
      expect(resolved.from).toBeGreaterThan(0);
      expect(resolved.to).toBeGreaterThanOrEqual(resolved.from);
    }
  });

  test("EVAL_INDEX=off builds no index and reviews in absent mode", async () => {
    const { logger, entries } = createCapturingLogger();
    const indexes: (RepositoryIndex | undefined)[] = [];

    expect(await fixtureIndex(fixture, logger, { EVAL_INDEX: "off" })).toBeUndefined();

    const review = await runFixtureReview(fixture, scriptedDeps(logger, indexes), {
      EVAL_INDEX: "off",
    });
    expect(review.index).toBeUndefined();
    expect(indexes).toEqual([undefined]);
    expect(
      entries.filter((entry) => String(entry.event).startsWith("eval.index")),
    ).toEqual([]);
    expect(review.result.findings).toEqual([]);
  });
});
