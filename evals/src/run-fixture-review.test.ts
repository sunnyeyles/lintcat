/** The harness's own wiring: what an evaluated review is, minus the model. */
import type { AgentDefinition, ReviewAgent } from "@pr-review/ai";
import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it, vi } from "vitest";

import { loadFixture } from "#src/fixture";
import {
  runFixtureReview,
  type FixtureReviewDeps,
} from "#src/run-fixture-review";

function scriptedDeps() {
  const built: AgentDefinition[] = [];
  const createAgent = vi.fn(({ agent }: { agent: AgentDefinition }): ReviewAgent => {
    built.push(agent);
    return { name: agent.name, run: async () => [] };
  });
  const { logger } = createCapturingLogger();
  const deps: FixtureReviewDeps = { engine: { createAgent }, logger };
  return { deps, built };
}

describe("runFixtureReview", () => {
  it("returns the check run the recording delivery kept", async () => {
    const { deps } = scriptedDeps();

    const review = await runFixtureReview(
      loadFixture("architecture-layer-bypass"),
      deps,
    );

    expect(review.rendered.output.title).toBeTypeOf("string");
    expect(review.result.findings).toEqual([]);
  });
});
