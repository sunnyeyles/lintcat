/** Anchor resolution and expectation judgement, over scripted reviews. */
import { describe, expect, it } from "vitest";

import { GENERAL_AGENT, type AgentDefinition } from "@pr-review/ai";
import { repositoryAgents } from "@pr-review/ai/agent-test-support";
import type { ChangedFile, PullRequestDetails } from "@pr-review/github";
import type { ReviewOutcome } from "@pr-review/reviewer";
import type { ReviewFinding } from "@pr-review/schemas";

import { evaluateExpectation, resolveAnchor } from "#src/expectations";
import type { LoadedFixture } from "#src/fixture";
import type { FixtureReview } from "#src/run-fixture-review";

const FILE = "src/services/order-summary.ts";

const CONTENTS = [
  "export function summarise(orderId: string) {",
  "  const order = loadOrder(orderId);",
  "  // START",
  "  for (const line of order.lines) {",
  "    line.product = loadProduct(line.productId);",
  "  }",
  "  // END",
  "  return order;",
  "}",
  "",
].join("\n");

const pullRequest: PullRequestDetails = {
  number: 41,
  title: "Summarise orders",
  body: null,
  author: "dev",
  baseRef: "main",
  baseSha: "a".repeat(40),
  headRef: "feature",
  headSha: "b".repeat(40),
};

const changedFiles: ChangedFile[] = [
  { filename: FILE, status: "modified", additions: 4, deletions: 0, patch: "@@ -1,1 +1,5 @@" },
];

const fixture: LoadedFixture = {
  name: "performance-n-plus-one",
  title: "Performance — N+1",
  manifest: {
    name: "performance-n-plus-one",
    title: "Performance — N+1",
    owner: "acme",
    repo: "shop",
    baseSha: pullRequest.baseSha,
    headSha: pullRequest.headSha,
    pullRequest: {
      number: 41,
      title: "Summarise orders",
      body: "",
      author: "dev",
      baseRef: "main",
      headRef: "feature",
    },
    changedFiles: [{ path: FILE, status: "modified" }],
  },
  pullRequest,
  changedFiles,
  diff: "",
  context: { owner: "acme", repo: "shop", pullRequest, changedFiles, diff: "" },
  headFiles: new Map([[FILE, CONTENTS]]),
  baseFiles: new Map([[FILE, "export function summarise() {}\n"]]),
};

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    category: "performance",
    severity: "high",
    confidence: 0.9,
    title: "N+1 query",
    explanation: "One query per line.",
    file: FILE,
    line: 5,
    ...overrides,
  };
}

function review(
  result: Partial<ReviewOutcome> = {},
  agents: readonly AgentDefinition[] = repositoryAgents(),
): FixtureReview {
  return {
    fixture,
    agents,
    result: {
      candidates: [],
      agentFailures: [],
      synthesis: { outcome: "skipped", candidates: [], reason: "no candidate findings" },
      findings: [],
      patches: { proposed: 0, verified: 0 },
      suppressed: 0,
      ...result,
    },
    rendered: { conclusion: "success", output: { title: "Review", summary: "" } },
  };
}

describe("resolveAnchor", () => {
  it("spans from the start marker to the end marker", () => {
    expect(resolveAnchor(fixture, { file: FILE, startMarker: "// START", endMarker: "// END" })).toEqual(
      { file: FILE, from: 3, to: 7 },
    );
  });

  it("runs to the end of the file when no end marker is given", () => {
    expect(resolveAnchor(fixture, { file: FILE, startMarker: "// START" })).toEqual({
      file: FILE,
      from: 3,
      to: 10,
    });
  });

  it("refuses a marker that matches no line", () => {
    expect(() => resolveAnchor(fixture, { file: FILE, startMarker: "// NOPE" })).toThrow(
      /"\/\/ NOPE" matches 0 lines of src\/services\/order-summary\.ts/,
    );
  });

  it("refuses a marker that matches more than one line", () => {
    expect(() => resolveAnchor(fixture, { file: FILE, startMarker: "  " })).toThrow(
      /matches \d+ lines of .*; it must match exactly one/,
    );
  });

  it("refuses a file the fixture does not contain", () => {
    expect(() => resolveAnchor(fixture, { file: "src/absent.ts", startMarker: "x" })).toThrow(
      /anchors src\/absent\.ts, which fixture performance-n-plus-one does not contain/,
    );
  });

  it("refuses a file the pull request does not change", () => {
    const unchanged: LoadedFixture = {
      ...fixture,
      headFiles: new Map([...fixture.headFiles, ["src/other.ts", "const x = 1;\n"]]),
    };

    expect(() => resolveAnchor(unchanged, { file: "src/other.ts", startMarker: "const x" })).toThrow(
      /pull request does not change/,
    );
  });
});

describe("evaluateExpectation", () => {
  const anchors = [{ file: FILE, startMarker: "// START", endMarker: "// END" }];
  const expectation = {
    kind: "finding",
    description: "reports the N+1",
    category: "performance",
    anchors,
  } as const;

  it("passes when a finding of the right category lands in the anchor", () => {
    const outcome = evaluateExpectation(review({ findings: [finding()] }), expectation);

    expect(outcome.passed).toBe(true);
    expect(outcome.detail).toContain("matched:");
    expect(outcome.detail).toContain(`${FILE}:5`);
  });

  it("passes a file-level finding, which still points at the planted problem", () => {
    expect(
      evaluateExpectation(review({ findings: [finding({ line: undefined })] }), expectation).passed,
    ).toBe(true);
  });

  it("fails a finding of the right category outside the anchor", () => {
    const outcome = evaluateExpectation(
      review({ findings: [finding({ line: 9 })] }),
      expectation,
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain(`${FILE}:3-7`);
    expect(outcome.detail).toContain("The review produced 1 finding(s)");
  });

  it("fails a finding in the right place but the wrong category", () => {
    expect(
      evaluateExpectation(review({ findings: [finding({ category: "security" })] }), expectation)
        .passed,
    ).toBe(false);
  });

  it("judges a lone standalone agent's findings by location, whatever it calls them", () => {
    const general = finding({ category: GENERAL_AGENT.category });

    expect(evaluateExpectation(review({ findings: [general] }, [GENERAL_AGENT]), expectation).passed).toBe(
      true,
    );
    expect(
      evaluateExpectation(review({ findings: [general] }, [GENERAL_AGENT, GENERAL_AGENT]), expectation)
        .passed,
    ).toBe(false);
    expect(
      evaluateExpectation(review({ findings: [finding()] }, [GENERAL_AGENT]), expectation).passed,
    ).toBe(false);
  });

  it("reports no findings at all in the failure detail", () => {
    const outcome = evaluateExpectation(review(), expectation);

    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("(no findings)");
  });

  it("judges no-findings by an empty review", () => {
    const clean = { kind: "no-findings", description: "clean" } as const;

    expect(evaluateExpectation(review(), clean).passed).toBe(true);
    const noisy = evaluateExpectation(review({ findings: [finding()] }), clean);
    expect(noisy.passed).toBe(false);
    expect(noisy.detail).toContain("false positive");
  });

  it("judges agents-completed by the failure list", () => {
    const completed = { kind: "agents-completed", description: "all agents ran" } as const;

    expect(evaluateExpectation(review(), completed)).toEqual({
      passed: true,
      detail: "every review agent completed",
    });
    const failed = evaluateExpectation(
      review({ agentFailures: [{ agent: "security", error: "timed out" }] }),
      completed,
    );
    expect(failed.passed).toBe(false);
    expect(failed.detail).toContain("- security: timed out");
  });

  it("judges patches-verify on precision, so proposing none passes", () => {
    const verify = { kind: "patches-verify", description: "patches match" } as const;

    expect(evaluateExpectation(review(), verify).passed).toBe(true);
    expect(
      evaluateExpectation(review({ patches: { proposed: 2, verified: 2 } }), verify),
    ).toEqual({ passed: true, detail: "2 of 2 proposed patch(es) matched the file" });
    const mismatched = evaluateExpectation(
      review({ patches: { proposed: 3, verified: 1 } }),
      verify,
    );
    expect(mismatched.passed).toBe(false);
    expect(mismatched.detail).toContain("2 of 3 proposed patch(es) did not match");
  });
});
