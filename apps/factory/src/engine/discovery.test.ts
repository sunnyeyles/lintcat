import { createFakeRuntime } from "#src/agent/fake-runtime";
import { describe, expect, it } from "vitest";

import { sampleSpec } from "#src/engine/test-fixtures";
import { runDiscovery, type DiscoveryIO } from "#src/engine/discovery";
import type { SpecAudit } from "#src/engine/spec-review";

const io = (answers: string[], decisions: Awaited<ReturnType<DiscoveryIO["review"]>>[]) => {
  const asked: string[] = [];
  const reviewed: string[] = [];
  const versions: string[] = [];
  const audits: (SpecAudit | undefined)[] = [];
  return {
    asked,
    reviewed,
    versions,
    audits,
    io: {
      ask: async (turn) => {
        asked.push(turn.question);
        return answers.shift() ?? "no preference";
      },
      review: async (spec, promptVersion, audit) => {
        reviewed.push(spec.title);
        versions.push(promptVersion);
        audits.push(audit);
        return decisions.shift() ?? { decision: "abort" };
      },
    } satisfies DiscoveryIO,
  };
};

const paraphrase = { proposes: "Adds an export command", existingSystem: "Commands live in src/cli.ts" };
const clean = () => ({ structured: { paraphrase, findings: [] } });
const findings = (...items: object[]) => () => ({ structured: { paraphrase, findings: items } });
const propose = (spec: object = sampleSpec, resolutions?: object[]) => () => ({
  structured: { kind: "proposal", spec, ...(resolutions ? { resolutions } : {}) },
});

describe("runDiscovery", () => {
  it("asks one question at a time, then gets one approval, resuming one session", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "question", question: "Which flag name?", facts: ["CLI in src/cli.ts"] } }),
      propose(),
      clean,
    ]);
    const { io: handlers, asked, versions } = io(["--version"], [{ decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "add a version flag", io: handlers });
    expect(result.status).toBe("approved");
    expect(asked).toEqual(["Which flag name?"]);
    expect(runtime.specs.map((s) => [s.role, s.readOnly])).toEqual([
      ["discovery", true],
      ["discovery", true],
      ["spec-reviewer", true],
    ]);
    expect(runtime.specs[1]?.resumeSessionId).toBe("fake-session-1");
    expect(runtime.specs[1]?.prompt).toBe("Answer: --version");
    expect(versions[0]).toMatch(/^discovery@/);
  });

  it("sends revision feedback and re-asks for a schema-valid answer", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "proposal" } }),
      propose(),
      clean,
      propose({ ...sampleSpec, title: "Add --version and -v" }),
      clean,
    ]);
    const { io: handlers, reviewed } = io([], [{ decision: "revise", feedback: "also -v" }, { decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
    expect(result).toMatchObject({ status: "approved", spec: { title: "Add --version and -v" } });
    expect(reviewed).toHaveLength(2);
    expect(runtime.specs[1]?.prompt).toMatch(/did not match the schema/);
    expect(runtime.specs[3]?.prompt).toMatch(/also -v/);
  });

  it("stops asking after the question cap", async () => {
    const question = () => ({ structured: { kind: "question", question: "more?" } });
    const runtime = createFakeRuntime([question, question, propose(), clean]);
    const { io: handlers } = io([], [{ decision: "abort" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers, maxQuestions: 1 });
    expect(result.status).toBe("aborted");
    expect(runtime.specs[2]?.prompt).toMatch(/No more questions/);
  });

  describe("the fresh spec review", () => {
    const feature = { ...sampleSpec, category: "feature" as const, title: "Add export" };
    const gap = { severity: "blocker", lens: "codebase", field: "plan", problem: "src/export.ts is said to exist but doesn't", evidence: [] };
    const scope = {
      severity: "blocker",
      lens: "scope",
      field: "category",
      problem: "refactor: the same parsing defect sits at two call sites",
      evidence: ["src/a.ts:10 parses by hand", "src/b.ts:22 parses by hand"],
    };

    it("has discovery resolve findings once, with no re-audit", async () => {
      const revised = { ...feature, plan: ["Create src/export.ts"] };
      const runtime = createFakeRuntime([propose(feature), findings(gap), propose(revised, [{ finding: "F1", action: "fix", note: "marked as new" }])]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "add export", io: handlers });

      expect(result).toMatchObject({ status: "approved", spec: { plan: ["Create src/export.ts"] } });
      expect(runtime.specs.map((s) => s.role)).toEqual(["discovery", "spec-reviewer", "discovery"]);
      const reviewer = runtime.specs[1]!;
      expect(reviewer.resumeSessionId).toBeUndefined();
      expect(reviewer.prompt).not.toContain("add export");
      expect(reviewer.prompt).toContain("Lenses for this spec: scope, comprehension, readiness, codebase");
      expect(runtime.specs[2]?.resumeSessionId).toBe("fake-session-1");
      expect(runtime.specs[2]?.prompt).toContain("F1 [blocker, codebase] plan");
      expect(audits[0]?.review?.findings).toHaveLength(1);
      expect(audits[0]?.resolutions).toMatchObject([{ action: "fix", note: "marked as new", finding: { id: "F1", field: "plan" } }]);
    });

    it("sends scope findings to the person, and discovery cannot change the category", async () => {
      const runtime = createFakeRuntime([
        propose(feature),
        findings(scope, gap),
        propose({ ...feature, category: "refactor" }, [{ finding: "F2", action: "fix", note: "fixed" }]),
      ]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });

      expect(result).toMatchObject({ status: "approved", spec: { category: "feature" } });
      expect(runtime.specs[2]?.prompt).not.toContain("parsing defect");
      expect(audits[0]?.review?.findings.map((f) => f.lens)).toEqual(["scope", "codebase"]);
      expect(audits[0]?.resolutions.map((r) => r.finding.id)).toEqual(["F2"]);
    });

    it("drops a scope finding without cited evidence", async () => {
      const runtime = createFakeRuntime([propose(feature), findings({ ...scope, evidence: [" "] })]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
      expect(runtime.specs).toHaveLength(2);
      expect(audits[0]?.review?.findings).toEqual([]);
    });

    it("checks only scope on a quick change", async () => {
      const runtime = createFakeRuntime([propose(), findings(gap, { ...scope, field: "estimatedFiles" })]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
      expect(runtime.specs[1]?.prompt).toContain("Lenses for this spec: scope.");
      expect(runtime.specs).toHaveLength(2);
      expect(audits[0]?.review?.findings).toMatchObject([{ lens: "scope", field: "estimatedFiles" }]);
    });

    it("goes straight to the person when only nits remain", async () => {
      const runtime = createFakeRuntime([propose(feature), findings({ ...gap, severity: "nit" })]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
      expect(runtime.specs).toHaveLength(2);
      expect(audits[0]).toMatchObject({ review: { findings: [{ severity: "nit" }] }, resolutions: [] });
    });

    it("never blocks discovery when the reviewer fails", async () => {
      const runtime = createFakeRuntime([propose(feature), () => ({ ok: false })]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
      expect(result.status).toBe("approved");
      expect(audits[0]).toEqual({ review: null, resolutions: [] });
    });

    it("is skipped when turned off", async () => {
      const runtime = createFakeRuntime([propose(feature)]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers, specReview: false });
      expect(audits).toEqual([undefined]);
    });
  });
});
