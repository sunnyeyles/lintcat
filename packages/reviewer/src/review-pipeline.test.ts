import {
  emptyTokenUsage,
  ReviewCancelledError,
  type ReviewAgent,
  type ReviewContext,
  type Synthesiser,
  type SynthesisHints,
} from "@pr-review/ai";
import type { ChangedFile } from "@pr-review/github";
import type { ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it, vi } from "vitest";

import { runReviewPipeline } from "#src/review-pipeline";

const changedFiles: ChangedFile[] = [
  {
    filename: "src/sessions.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -41,1 +41,2 @@\n context line 41\n+added line 42",
  },
];

const context: ReviewContext = {
  owner: "octo-org",
  repo: "example-service",
  pullRequest: {
    number: 42,
    title: "Add rate limiting",
    body: null,
    author: "octocat",
    baseRef: "main",
    baseSha: "0000000000000000000000000000000000000000",
    headRef: "feature/rate-limit",
    headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
  },
  // The agents and the validation step both read the changed-file list here.
  changedFiles,
  diff: "",
};

function agent(name: string, run: ReviewAgent["run"]): ReviewAgent {
  return { name, run };
}

/** A pass-through Synthesiser: returns its input verbatim as "findings". */
function passthroughSynthesiser(): Synthesiser {
  return {
    async synthesise(candidates) {
      return { findings: candidates as ReviewFinding[], usage: emptyTokenUsage() };
    },
  };
}

/** A schema-valid candidate finding, overridable per test. */
function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: "src/sessions.ts",
    line: 42,
    category: "correctness",
    severity: "high",
    title: "Assignment instead of comparison in admin check",
    explanation:
      "The if condition assigns true to user.isAdmin instead of comparing, so every user passes the check.",
    confidence: 0.9,
    ...overrides,
  };
}

describe("runReviewPipeline: agent fan-out and partial failure (spec §20)", () => {
  it("runs the agents against the context and validates their candidates", async () => {
    const finding = makeFinding();
    const result = await runReviewPipeline(
      [agent("correctness", async () => [finding])],
      passthroughSynthesiser(),
      context,
    );

    expect(result.candidates).toEqual([finding]);
    expect(result.agentFailures).toEqual([]);
    expect(result.findings).toEqual([finding]);
  });

  it("combines candidates from multiple agents in agent order", async () => {
    const a = makeFinding({ title: "A" });
    const b = makeFinding({ title: "B", line: 43 });
    const result = await runReviewPipeline(
      [
        agent("correctness", async () => [a]),
        agent("security", async () => [b]),
      ],
      passthroughSynthesiser(),
      context,
    );

    expect(result.candidates).toEqual([a, b]);
  });

  it("records a failed agent and still returns the successful agent's candidates", async () => {
    const b = makeFinding({ title: "B" });
    const result = await runReviewPipeline(
      [
        agent("correctness", async () => {
          throw new Error("model unavailable");
        }),
        agent("security", async () => [b]),
      ],
      passthroughSynthesiser(),
      context,
    );

    expect(result.candidates).toEqual([b]);
    expect(result.agentFailures).toEqual([
      { agent: "correctness", error: "model unavailable" },
    ]);
  });

  it("starts every agent before any of them resolves (real concurrency)", async () => {
    const starts: string[] = [];
    const resolvers: (() => void)[] = [];
    const gated = (name: string) =>
      agent(name, () => {
        starts.push(name);
        return new Promise((resolve) => {
          resolvers.push(() => resolve([makeFinding({ title: name })]));
        });
      });

    const pending = runReviewPipeline(
      [gated("correctness"), gated("security"), gated("architecture")],
      passthroughSynthesiser(),
      context,
    );

    // Every agent has started and none has resolved: a sequential runner
    // would still be on the first.
    expect(starts).toEqual(["correctness", "security", "architecture"]);

    for (const resolve of resolvers) {
      resolve();
    }
    const result = await pending;
    expect(result.candidates.map((c) => (c as ReviewFinding).title)).toEqual([
      "correctness",
      "security",
      "architecture",
    ]);
    expect(result.agentFailures).toEqual([]);
  });

  it("with one of three agents failing, keeps the other two agents' candidates, in order", async () => {
    const correctness = makeFinding({ category: "correctness", title: "c" });
    const architecture = makeFinding({ category: "architecture", title: "a" });
    const result = await runReviewPipeline(
      [
        agent("correctness", async () => [correctness]),
        agent("security", async () => {
          throw new Error("model unavailable");
        }),
        agent("architecture", async () => [architecture]),
      ],
      passthroughSynthesiser(),
      context,
    );

    expect(result.candidates).toEqual([correctness, architecture]);
    expect(result.agentFailures).toEqual([
      { agent: "security", error: "model unavailable" },
    ]);
  });

  it("throws when all three agents fail, naming every agent", async () => {
    const failing = (name: string) =>
      agent(name, async () => {
        throw new Error(`${name} exploded`);
      });

    await expect(
      runReviewPipeline(
        [failing("correctness"), failing("security"), failing("architecture")],
        passthroughSynthesiser(),
        context,
      ),
    ).rejects.toThrow(
      /correctness: correctness exploded.*security: security exploded.*architecture: architecture exploded/s,
    );
  });

  it("throws when every agent fails (single-agent failure fails the review)", async () => {
    const failing = agent("correctness", async () => {
      throw new Error("invalid findings JSON");
    });

    await expect(
      runReviewPipeline([failing], passthroughSynthesiser(), context),
    ).rejects.toThrow(/correctness.*invalid findings JSON/s);
  });

  it("throws when no agents are configured", async () => {
    await expect(
      runReviewPipeline([], passthroughSynthesiser(), context),
    ).rejects.toThrow(/at least one review agent/i);
  });
});

describe("runReviewPipeline: synthesis (spec §16)", () => {
  it("skips synthesis with zero candidates and validates the (empty) result", async () => {
    const result = await runReviewPipeline(
      [agent("correctness", async () => [])],
      passthroughSynthesiser(),
      context,
    );

    expect(result.synthesis).toEqual({
      outcome: "skipped",
      candidates: [],
      reason: "no candidate findings",
    });
    expect(result.findings).toEqual([]);
  });

  it("skips synthesis when a standalone agent runs alone, validating its raw findings", async () => {
    const finding = makeFinding({ category: "general" });
    const synthesiser: Synthesiser = {
      async synthesise() {
        throw new Error("the synthesiser must not run");
      },
    };

    const result = await runReviewPipeline(
      [{ ...agent("general", async () => [finding]), standalone: true }],
      synthesiser,
      context,
    );

    expect(result.synthesis).toEqual({
      outcome: "skipped",
      candidates: [finding],
      reason: "standalone agent",
    });
    expect(result.findings).toEqual([finding]);
  });

  it("still synthesises a lone specialist, so narrowed runs take the full path", async () => {
    const synthesise = vi.fn(async (candidates: readonly unknown[]) => ({
      findings: candidates as ReviewFinding[],
      usage: emptyTokenUsage(),
    }));

    const result = await runReviewPipeline(
      [agent("correctness", async () => [makeFinding()])],
      { synthesise },
      context,
    );

    expect(synthesise).toHaveBeenCalledOnce();
    expect(result.synthesis.outcome).toBe("completed");
  });

  it("feeds raw candidates through the synthesiser and validates its output", async () => {
    const raw = makeFinding({ severity: "low", confidence: 0.5 });
    const refined = makeFinding({ severity: "high", confidence: 0.95 });
    const synthesiser: Synthesiser = {
      async synthesise(candidates) {
        expect(candidates).toEqual([raw]);
        return { findings: [refined], usage: { ...emptyTokenUsage(), inputTokens: 10, outputTokens: 5 } };
      },
    };

    const result = await runReviewPipeline(
      [agent("correctness", async () => [raw])],
      synthesiser,
      context,
    );

    expect(result.synthesis).toMatchObject({
      outcome: "completed",
      candidates: [refined],
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    // The tag carries it, so a completed synthesis cannot be missing a duration.
    expect(result.synthesis).toHaveProperty("durationMs", expect.any(Number));
    expect(result.findings).toEqual([refined]);
  });

  it("passes the repository's synthesis hints to the synthesiser", async () => {
    const raw = makeFinding();
    const hints = { keep: ["Security: Findings like \"broken auth\"."], drop: [] };
    let seen: unknown;
    const synthesiser: Synthesiser = {
      async synthesise(candidates, given) {
        seen = given;
        return { findings: candidates as ReviewFinding[], usage: emptyTokenUsage() };
      },
    };

    await runReviewPipeline(
      [agent("correctness", async () => [raw])],
      synthesiser,
      context,
      hints,
    );

    expect(seen).toEqual(hints);
  });

  it("falls back to the raw candidates when synthesis fails, and still validates them", async () => {
    const raw = makeFinding();
    const failing: Synthesiser = {
      async synthesise() {
        throw new Error("anthropic unavailable");
      },
    };

    const result = await runReviewPipeline(
      [agent("correctness", async () => [raw])],
      failing,
      context,
    );

    expect(result.synthesis).toMatchObject({
      outcome: "failed",
      error: "anthropic unavailable",
    });
    // Fallback candidates still flow through the same validation chain.
    expect(result.findings).toEqual([raw]);
  });
});

describe("runReviewPipeline: deterministic validation (spec §17)", () => {
  it("is never the final authority: a fabricated file/line is dropped by validation", async () => {
    const fabricated = makeFinding({ file: "src/not-part-of-this-pr.ts", line: 7 });
    const synthesiser: Synthesiser = {
      async synthesise() {
        return { findings: [fabricated], usage: emptyTokenUsage() };
      },
    };

    const result = await runReviewPipeline(
      [agent("correctness", async () => [makeFinding()])],
      synthesiser,
      context,
    );

    expect(result.candidates).toEqual([makeFinding()]);
    expect(result.findings).toEqual([]);
  });

  it("validates against the context's changed-file list, the only list there is", async () => {
    // Changed files differ from the module-level fixture: validation
    // must follow the list the agents were handed.
    const otherFile: ChangedFile = {
      filename: "src/rate-limit.ts",
      status: "added",
      additions: 2,
      deletions: 0,
      patch: "@@ -0,0 +1,2 @@\n+added line 1\n+added line 2",
    };
    const otherContext: ReviewContext = { ...context, changedFiles: [otherFile] };

    const inThisPr = makeFinding({ file: "src/rate-limit.ts", line: 2 });
    // In the module-level fixture, but not in the context the agents saw.
    const notInThisPr = makeFinding({ file: "src/sessions.ts", line: 42 });

    const seenByAgent: (readonly ChangedFile[])[] = [];
    const result = await runReviewPipeline(
      [
        agent("correctness", async (agentContext) => {
          seenByAgent.push(agentContext.changedFiles);
          return [inThisPr, notInThisPr];
        }),
      ],
      passthroughSynthesiser(),
      otherContext,
    );

    expect(seenByAgent).toEqual([[otherFile]]);
    expect(result.candidates).toEqual([inThisPr, notInThisPr]);
    expect(result.findings).toEqual([inThisPr]);
  });
});

describe("runReviewPipeline: cancellation", () => {
  /** What an aborted model call rejects with. */
  function abortError(): Error {
    return new DOMException("The operation was aborted", "AbortError");
  }

  function cancellableSynthesiser() {
    return {
      synthesise: vi.fn(
        async (
          candidates: readonly unknown[],
          _hints?: SynthesisHints,
          _signal?: AbortSignal,
        ) => ({
          findings: candidates as ReviewFinding[],
          usage: emptyTokenUsage(),
        }),
      ),
    };
  }

  it("starts no agent when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = vi.fn(async () => [makeFinding()]);

    await expect(
      runReviewPipeline([agent("correctness", run)], passthroughSynthesiser(), {
        ...context,
        signal: controller.signal,
      }),
    ).rejects.toThrow(ReviewCancelledError);
    expect(run).not.toHaveBeenCalled();
  });

  it("throws instead of returning a partial result when an agent is cancelled", async () => {
    const controller = new AbortController();
    const synthesiser = cancellableSynthesiser();

    await expect(
      runReviewPipeline(
        [
          agent("correctness", async () => [makeFinding()]),
          agent("security", async () => {
            controller.abort();
            throw abortError();
          }),
        ],
        synthesiser,
        { ...context, signal: controller.signal },
      ),
    ).rejects.toThrow(ReviewCancelledError);
    expect(synthesiser.synthesise).not.toHaveBeenCalled();
  });

  it("hands the signal to the synthesiser", async () => {
    const controller = new AbortController();
    const synthesiser = cancellableSynthesiser();

    await runReviewPipeline(
      [agent("correctness", async () => [makeFinding()])],
      synthesiser,
      { ...context, signal: controller.signal },
    );

    expect(synthesiser.synthesise.mock.calls[0]?.[2]).toBe(controller.signal);
  });

  it("completes normally while the signal stays live", async () => {
    const controller = new AbortController();
    const finding = makeFinding();

    const result = await runReviewPipeline(
      [agent("correctness", async () => [finding])],
      passthroughSynthesiser(),
      { ...context, signal: controller.signal },
    );

    expect(result.findings).toEqual([finding]);
    expect(result.agentFailures).toEqual([]);
  });
});
