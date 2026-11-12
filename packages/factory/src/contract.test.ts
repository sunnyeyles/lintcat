import { describe, expect, it } from "vitest";

import { assertFrozen, ContractTamperedError, freezeContract, recordDecision, type TaskContract } from "#src/contract";
import { loadProfiles } from "#src/profiles";
import { loadPrompt } from "#src/prompts";
import { routeTask } from "#src/router";
import { sampleSpec } from "#src/test-fixtures";

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
    expect(() => assertFrozen(edited)).toThrow(ContractTamperedError);
  });

  it("lets implementation decisions be appended without breaking the freeze", () => {
    const frozen = recordDecision(freezeContract(draft, new Date(0)), "implement", "reuse parseArgs", new Date(1));
    expect(frozen.implementationDecisions).toHaveLength(1);
    expect(() => assertFrozen(frozen)).not.toThrow();
  });

  it("refuses to approve an unrouted pending contract", () => {
    expect(() => assertFrozen(draft)).toThrow(ContractTamperedError);
  });
});

describe("routeTask", () => {
  const profiles = loadProfiles();

  it("routes small low-risk work to quick", () => {
    expect(routeTask(sampleSpec, profiles)).toMatchObject({ ok: true, profile: "quick", overridden: false });
  });

  it("routes defects, structural work and larger features to their own profiles", () => {
    expect(routeTask({ ...sampleSpec, category: "bugfix" }, profiles)).toMatchObject({ ok: true, profile: "bugfix" });
    expect(routeTask({ ...sampleSpec, category: "refactor" }, profiles)).toMatchObject({ ok: true, profile: "refactor" });
    expect(routeTask({ ...sampleSpec, estimatedFiles: 12 }, profiles)).toMatchObject({ ok: true, profile: "feature" });
    expect(routeTask({ ...sampleSpec, touchesSecurityOrData: true }, profiles)).toMatchObject({ ok: true, profile: "feature" });
  });

  it("blocks a profile that is disabled", () => {
    const disabled = profiles.map((p) => (p.name === "feature" ? { ...p, enabled: false } : p));
    expect(routeTask({ ...sampleSpec, estimatedFiles: 12 }, disabled)).toMatchObject({ ok: false, blocker: expect.stringMatching(/feature/) });
  });

  it("allows a heavier override but never a lighter one for risky work", () => {
    expect(routeTask(sampleSpec, profiles, "feature")).toMatchObject({ ok: true, profile: "feature", overridden: true });
    expect(routeTask({ ...sampleSpec, category: "bugfix", risk: "high" }, profiles, "quick")).toMatchObject({ ok: false });
  });

  it("allows a lighter override only for low-risk work", () => {
    expect(routeTask({ ...sampleSpec, estimatedFiles: 12 }, profiles, "quick")).toMatchObject({ ok: true, profile: "quick", overridden: true });
    expect(routeTask({ ...sampleSpec, touchesSecurityOrData: true }, profiles, "quick")).toMatchObject({ ok: false });
  });
});

describe("loadPrompt", () => {
  it("versions each prompt by role, number and content", () => {
    expect(loadPrompt("implementer").version).toMatch(/^implementer@2\+[0-9a-f]{8}$/);
    expect(loadPrompt("reviewer").version).toMatch(/^reviewer@1\+[0-9a-f]{8}$/);
    expect(loadPrompt("discovery").text).toContain("one consolidated");
  });
});
