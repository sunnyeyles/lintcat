/** The harness's own wiring: what an evaluated review is, minus the model. */
import {
  emptyTokenUsage,
  type ReviewAgent,
  type Synthesiser,
  type SynthesisHints,
} from "@pr-review/ai";
import { repositoryAgents } from "@pr-review/ai/agent-test-support";
import { createCapturingLogger } from "@pr-review/logging";
import type { MemoryStore } from "@pr-review/reviewer";
import { reviewMemorySchema, type ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it, vi } from "vitest";

import { loadFixture } from "#src/fixture";
import {
  runFixtureReview,
  type FixtureReviewDeps,
} from "#src/run-fixture-review";

const NOW = new Date("2026-09-13T12:00:00.000Z");

/** One shape this repository has kept acting on, so synthesis earns a hint. */
function memoryFile(): string {
  return JSON.stringify(
    reviewMemorySchema.parse({
      version: 1,
      shapes: [
        {
          category: "correctness",
          shape: "assignment instead of comparison in",
          resolved: 4,
          ignored: 0,
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

function scriptedDeps(candidates: readonly ReviewFinding[] = []) {
  const synthesise = vi.fn(
    async (given: readonly unknown[], _hints?: SynthesisHints) => ({
      findings: given as ReviewFinding[],
      usage: emptyTokenUsage(),
    }),
  );
  const synthesiser: Synthesiser = { synthesise };
  const { logger, entries } = createCapturingLogger();
  const deps: FixtureReviewDeps = {
    agents: repositoryAgents(),
    createAgents: ({ agents }) =>
      agents.map(
        (agent): ReviewAgent => ({
          name: agent.category,
          run: async () => candidates,
        }),
      ),
    synthesiser,
    logger,
  };
  return { deps, synthesise, entries };
}

/** Enough to reach synthesis: it runs only over candidates. */
const candidate: ReviewFinding = {
  file: "src/auth.ts",
  line: 1,
  category: "correctness",
  severity: "high",
  title: "Assignment instead of comparison in admin check",
  explanation:
    "The if condition assigns true to user.isAdmin instead of comparing, so every user passes the check.",
  confidence: 0.9,
};

describe("runFixtureReview", () => {
  it("returns the check run the recording delivery kept", async () => {
    const { deps } = scriptedDeps();

    const review = await runFixtureReview(
      loadFixture("correctness-admin-check"),
      deps,
    );

    expect(review.rendered.output.title).toBeTypeOf("string");
    expect(review.result.findings).toEqual([]);
  });

  it("reaches synthesis with the hints the repository's memory earned", async () => {
    const { deps, synthesise } = scriptedDeps([candidate]);

    await runFixtureReview(loadFixture("correctness-admin-check"), {
      ...deps,
      memory: { store: readOnlyStore(memoryFile()), now: () => NOW },
    });

    expect(synthesise.mock.calls[0]?.[1]).toEqual({
      keep: ['Correctness: Findings like "assignment instead of comparison in".'],
      drop: [],
    });
  });

  it("synthesises unhinted when the fixture has no memory", async () => {
    const { deps, synthesise } = scriptedDeps([candidate]);

    await runFixtureReview(loadFixture("correctness-admin-check"), deps);

    const [, hints] = synthesise.mock.calls[0] ?? [];
    expect(hints).toEqual({ keep: [], drop: [] });
  });
});
