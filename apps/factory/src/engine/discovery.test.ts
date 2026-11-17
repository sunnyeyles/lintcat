import { createFakeRuntime } from "#src/agent/fake-runtime";
import { describe, expect, it } from "vitest";

import { sampleSpec } from "#src/engine/test-fixtures";
import { runDiscovery, type DiscoveryIO } from "#src/engine/discovery";
import type { SpecAudit } from "#src/engine/spec-review";

const io = (answers: string[], decisions: Awaited<ReturnType<DiscoveryIO["review"]>>[]) => {
  const asked: string[] = [];
  const reviewed: string[] = [];
  const audits: (SpecAudit | undefined)[] = [];
  return {
    asked,
    reviewed,
    audits,
    io: {
      ask: async (turn) => {
        asked.push(turn.question);
        return answers.shift() ?? "no preference";
      },
      review: async (spec, _version, audit) => {
        reviewed.push(spec.title);
        audits.push(audit);
        return decisions.shift() ?? { decision: "abort" };
      },
    } satisfies DiscoveryIO,
  };
};

describe("runDiscovery", () => {
  it("asks one question at a time, then gets one approval, resuming one session", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "question", question: "Which flag name?", facts: ["CLI in src/cli.ts"] } }),
      () => ({ structured: { kind: "proposal", spec: sampleSpec } }),
    ]);
    const { io: handlers, asked } = io(["--version"], [{ decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "add a version flag", io: handlers });
    expect(result.status).toBe("approved");
    expect(asked).toEqual(["Which flag name?"]);
    expect(runtime.specs.map((s) => s.readOnly)).toEqual([true, true]);
    expect(runtime.specs[1]?.resumeSessionId).toBe("fake-session-1");
    expect(runtime.specs[1]?.prompt).toBe("Answer: --version");
  });

  it("sends revision feedback and re-asks for a schema-valid answer", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "proposal" } }),
      () => ({ structured: { kind: "proposal", spec: sampleSpec } }),
      () => ({ structured: { kind: "proposal", spec: { ...sampleSpec, title: "Add --version and -v" } } }),
    ]);
    const { io: handlers, reviewed } = io([], [{ decision: "revise", feedback: "also -v" }, { decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
    expect(result).toMatchObject({ status: "approved", spec: { title: "Add --version and -v" } });
    expect(reviewed).toHaveLength(2);
    expect(runtime.specs[1]?.prompt).toMatch(/did not match the schema/);
    expect(runtime.specs[2]?.prompt).toMatch(/also -v/);
  });

  it("stops asking after the question cap", async () => {
    const question = () => ({ structured: { kind: "question", question: "more?" } });
    const runtime = createFakeRuntime([question, question, () => ({ structured: { kind: "proposal", spec: sampleSpec } })]);
    const { io: handlers } = io([], [{ decision: "abort" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers, maxQuestions: 1 });
    expect(result.status).toBe("aborted");
    expect(runtime.specs[2]?.prompt).toMatch(/No more questions/);
  });

  describe("the fresh spec review", () => {
    const feature = { ...sampleSpec, category: "feature" as const, title: "Add export" };
    const paraphrase = { proposes: "Adds an export command", existingSystem: "Commands live in src/cli.ts" };
    const gap = { severity: "blocker", lens: "codebase", field: "plan", problem: "src/export.ts is said to exist but doesn't" };

    it("has discovery resolve real findings, re-audits once, and shows both", async () => {
      const revised = { ...feature, plan: ["Create src/export.ts"] };
      const runtime = createFakeRuntime([
        () => ({ structured: { kind: "proposal", spec: feature } }),
        () => ({ structured: { paraphrase, findings: [gap] } }),
        () => ({ structured: { kind: "proposal", spec: revised, resolutions: [{ finding: "F1", action: "fix", note: "marked as new" }] } }),
        () => ({ structured: { paraphrase, findings: [] } }),
      ]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "add export", io: handlers });

      expect(result).toMatchObject({ status: "approved", spec: { plan: ["Create src/export.ts"] } });
      expect(runtime.specs.map((s) => s.role)).toEqual(["discovery", "spec-reviewer", "discovery", "spec-reviewer"]);
      const reviewer = runtime.specs[1]!;
      expect(reviewer.readOnly).toBe(true);
      expect(reviewer.resumeSessionId).toBeUndefined();
      expect(reviewer.prompt).not.toContain("add export");
      expect(runtime.specs[2]?.resumeSessionId).toBe("fake-session-1");
      expect(runtime.specs[2]?.prompt).toContain("F1 [blocker, codebase] plan");
      expect(runtime.specs[3]?.prompt).toContain("Create src/export.ts");
      expect(audits[0]?.review?.findings).toEqual([]);
      expect(audits[0]?.resolutions).toMatchObject([{ action: "fix", note: "marked as new", finding: { id: "F1", field: "plan" } }]);
    });

    it("goes straight to the person when only nits remain", async () => {
      const runtime = createFakeRuntime([
        () => ({ structured: { kind: "proposal", spec: feature } }),
        () => ({ structured: { paraphrase, findings: [{ ...gap, severity: "nit" }] } }),
      ]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
      expect(runtime.specs).toHaveLength(2);
      expect(audits[0]).toMatchObject({ review: { findings: [{ severity: "nit" }] }, resolutions: [] });
    });

    it("never blocks discovery when the reviewer fails", async () => {
      const runtime = createFakeRuntime([() => ({ structured: { kind: "proposal", spec: feature } }), () => ({ ok: false })]);
      const { io: handlers, audits } = io([], [{ decision: "approve" }]);
      const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
      expect(result.status).toBe("approved");
      expect(audits[0]).toEqual({ review: null, resolutions: [] });
    });

    it("is skipped for quick changes and when turned off", async () => {
      const quick = createFakeRuntime([() => ({ structured: { kind: "proposal", spec: sampleSpec } })]);
      const off = createFakeRuntime([() => ({ structured: { kind: "proposal", spec: feature } })]);
      const a = io([], [{ decision: "approve" }]);
      const b = io([], [{ decision: "approve" }]);
      await runDiscovery({ runtime: quick, repoPath: "/repo", outcome: "x", io: a.io });
      await runDiscovery({ runtime: off, repoPath: "/repo", outcome: "x", io: b.io, specReview: false });
      expect([...a.audits, ...b.audits]).toEqual([undefined, undefined]);
    });
  });
});
