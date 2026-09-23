/** The harness's own wiring: what an evaluated review is, minus the model. */
import type { AgentDefinition, ReviewAgent } from "@pr-review/ai";
import { createCapturingLogger } from "@pr-review/logging";
import type { MemoryStore } from "@pr-review/reviewer";
import { reviewMemorySchema } from "@pr-review/schemas";
import { describe, expect, it, vi } from "vitest";

import { loadFixture } from "#src/fixture";
import {
  runFixtureReview,
  type FixtureReviewDeps,
} from "#src/run-fixture-review";

const NOW = new Date("2026-09-13T12:00:00.000Z");

/** One shape this repository keeps ignoring, so the agent earns a hint. */
function memoryFile(): string {
  return JSON.stringify(
    reviewMemorySchema.parse({
      version: 1,
      shapes: [
        {
          category: "general",
          shape: "assignment instead of comparison in",
          resolved: 0,
          ignored: 5,
          outdated: 0,
          lastSignalAt: NOW.toISOString(),
        },
      ],
    }),
  );
}

function readOnlyStore(content: string): MemoryStore {
  return { read: async () => content, write: async () => {} };
}

function scriptedDeps() {
  const built: AgentDefinition[] = [];
  const createAgent = vi.fn(({ agent }: { agent: AgentDefinition }): ReviewAgent => {
    built.push(agent);
    return { name: agent.category, run: async () => [] };
  });
  const { logger } = createCapturingLogger();
  const deps: FixtureReviewDeps = { createAgent, logger };
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

  it("hands the agent the hints the repository's memory earned", async () => {
    const { deps, built } = scriptedDeps();

    await runFixtureReview(loadFixture("architecture-layer-bypass"), {
      ...deps,
      memory: { store: readOnlyStore(memoryFile()), now: () => NOW },
    });

    expect(built[0]?.repositoryHints).toEqual([
      'Findings like "assignment instead of comparison in".',
    ]);
  });

  it("runs the agent unhinted when the fixture has no memory", async () => {
    const { deps, built } = scriptedDeps();

    await runFixtureReview(loadFixture("architecture-layer-bypass"), deps);

    expect(built[0]?.repositoryHints).toBeUndefined();
  });
});
