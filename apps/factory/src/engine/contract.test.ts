import { describe, expect, it } from "vitest";

import { assertFrozen, freezeContract, recordDecision, type TaskContract } from "#src/engine/contract";
import { loadPrompt } from "#src/engine/prompts";
import { routeTask } from "#src/engine/profiles";
import { sampleSpec } from "#src/engine/test-fixtures";

const draft: TaskContract = {
  contractVersion: 1,
  taskId: "r1",
  repoPath: "/repo",
  baseSha: "a".repeat(40),
  baseBranch: "main",
  profile: "quick",
  routing: { reason: "small", overridden: false },
  spec: sampleSpec,
  permittedOperations: { push: false, openPullRequest: false, networkDuringSetup: true },
  budgets: { maxAgentTurns: 10, maxRepairPasses: 2, wallClockMinutes: 5, commandTimeoutSeconds: 60 },
  approval: { state: "pending" },
  implementationDecisions: [],
};

describe("task contract", () => {
  it("freezes once and detects any later change to approved fields", () => {
    const frozen = freezeContract(draft, new Date(0));
    expect(() => assertFrozen(frozen)).not.toThrow();
    expect(() => freezeContract(frozen, new Date())).toThrow(/already approved/);
    const edited = { ...frozen, spec: { ...frozen.spec, acceptanceCriteria: [] } };
    expect(() => assertFrozen(edited)).toThrow(/changed after approval/);
  });

  it("lets implementation decisions be appended without breaking the freeze", () => {
    const frozen = recordDecision(freezeContract(draft, new Date(0)), "implement", "reuse parseArgs", new Date(1));
    expect(frozen.implementationDecisions).toHaveLength(1);
    expect(() => assertFrozen(frozen)).not.toThrow();
  });

  it("refuses to approve an unrouted pending contract", () => {
    expect(() => assertFrozen(draft)).toThrow(/changed after approval/);
  });
});

describe("routeTask", () => {
  it("routes small low-risk work to quick", () => {
    expect(routeTask(sampleSpec)).toMatchObject({ profile: "quick", overridden: false });
  });

  it("routes defects, structural work and larger features to their own profiles", () => {
    expect(routeTask({ ...sampleSpec, category: "bugfix" })).toMatchObject({ profile: "bugfix" });
    expect(routeTask({ ...sampleSpec, category: "refactor" })).toMatchObject({ profile: "refactor" });
    expect(routeTask({ ...sampleSpec, estimatedFiles: 12 })).toMatchObject({ profile: "feature" });
    expect(routeTask({ ...sampleSpec, touchesSecurityOrData: true })).toMatchObject({ profile: "feature" });
  });

  it("honours an override", () => {
    expect(routeTask(sampleSpec, "feature")).toMatchObject({ profile: "feature", overridden: true });
  });
});

describe("loadPrompt", () => {
  it("versions each prompt by role, number and content", () => {
    expect(loadPrompt("implementer").version).toMatch(/^implementer@2\+[0-9a-f]{8}$/);
    expect(loadPrompt("reviewer").version).toMatch(/^reviewer@1\+[0-9a-f]{8}$/);
    expect(loadPrompt("discovery").text).toContain("one consolidated");
  });
});
