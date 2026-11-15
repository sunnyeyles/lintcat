import { createFakeRuntime } from "@pr-review/agent-runtime";
import { describe, expect, it } from "vitest";

import type { Spec } from "#src/contract";
import { sampleSpec } from "#src/test-fixtures";
import { runDiscovery, type DiscoveryIO } from "#src/discovery";

const io = (answers: string[], decisions: Awaited<ReturnType<DiscoveryIO["review"]>>[]) => {
  const asked: string[] = [];
  const reviewed: Spec[] = [];
  return {
    asked,
    reviewed,
    io: {
      ask: async (turn) => {
        asked.push(turn.question);
        return answers.shift() ?? "no preference";
      },
      review: async (spec) => {
        reviewed.push(spec);
        return decisions.shift() ?? { decision: "abort" };
      },
    } satisfies DiscoveryIO,
  };
};

const accept = () => ({ structured: { verdict: "accept", reason: "", evidence: [], followUps: [] } });
const bugfix: Spec = { ...sampleSpec, category: "bugfix" };
const pushback = () => ({
  structured: {
    verdict: "change",
    category: "refactor",
    reason: "The same missing null check sits behind one shallow helper at four call sites.",
    evidence: ["src/a.mjs:3", "src/b.mjs:9"],
    followUps: [],
  },
});

describe("runDiscovery", () => {
  it("asks one question at a time, then gets one approval, resuming one session", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "question", question: "Which flag name?", facts: ["CLI in src/cli.ts"] } }),
      () => ({ structured: { kind: "proposal", spec: sampleSpec } }),
      accept,
    ]);
    const { io: handlers, asked, reviewed } = io(["--version"], [{ decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "add a version flag", io: handlers });
    expect(result.status).toBe("approved");
    expect(asked).toEqual(["Which flag name?"]);
    expect(runtime.specs.map((s) => [s.role, s.readOnly])).toEqual([["discovery", true], ["discovery", true], ["scoper", true]]);
    expect(runtime.specs[1]?.resumeSessionId).toBe("fake-session-1");
    expect(runtime.specs[1]?.prompt).toBe("Answer: --version");
    expect(runtime.specs[2]?.resumeSessionId).toBeUndefined();
    expect(reviewed[0]?.scoping).toBeUndefined();
  });

  it("sends revision feedback and re-asks for a schema-valid answer, scoping only once", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "proposal" } }),
      () => ({ structured: { kind: "proposal", spec: sampleSpec } }),
      accept,
      () => ({ structured: { kind: "proposal", spec: { ...sampleSpec, title: "Add --version and -v" } } }),
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
    const runtime = createFakeRuntime([question, question, () => ({ structured: { kind: "proposal", spec: sampleSpec } }), accept]);
    const { io: handlers } = io([], [{ decision: "abort" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers, maxQuestions: 1 });
    expect(result.status).toBe("aborted");
    expect(runtime.specs[2]?.prompt).toMatch(/No more questions/);
  });
});

describe("scoping in discovery", () => {
  it("hands a pushback to discovery, and records it as applied when the category changes", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "proposal", spec: bugfix } }),
      pushback,
      () => ({ structured: { kind: "proposal", spec: { ...bugfix, category: "refactor" } } }),
    ]);
    const { io: handlers, reviewed } = io([], [{ decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "fix the null crash", io: handlers });
    expect(result.status).toBe("approved");
    expect(runtime.specs[1]?.prompt).toContain('"category": "bugfix"');
    expect(runtime.specs[2]).toMatchObject({ role: "discovery", resumeSessionId: "fake-session-1" });
    expect(runtime.specs[2]?.prompt).toContain("proposes `refactor` instead of `bugfix`");
    expect(runtime.specs[2]?.prompt).toContain("- src/a.mjs:3");
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]?.scoping).toMatchObject({ verdict: "change", from: "bugfix", proposed: "refactor", applied: true });
    expect(reviewed[0]?.scoping?.promptVersion).toMatch(/^scoper@1\+/);
  });

  it("records a rebuttal when discovery keeps its category, and never scopes twice", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "proposal", spec: bugfix } }),
      pushback,
      () => ({ structured: { kind: "proposal", spec: { ...bugfix, assumptions: ["one-off: the other sites are already guarded"] } } }),
      () => ({ structured: { kind: "proposal", spec: { ...bugfix, title: "Fix it, tested" } } }),
    ]);
    const { io: handlers, reviewed } = io([], [{ decision: "revise", feedback: "add a test" }, { decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "fix the null crash", io: handlers });
    expect(result.status).toBe("approved");
    expect(runtime.specs.filter((s) => s.role === "scoper")).toHaveLength(1);
    expect(reviewed.map((s) => s.scoping?.applied)).toEqual([false, false]);
  });

  it("ignores a scoping record the discovery agent wrote itself", async () => {
    const forged = { verdict: "change", from: "quick", proposed: "quick", reason: "x", evidence: [], followUps: [], applied: true, promptVersion: "x" };
    const runtime = createFakeRuntime([() => ({ structured: { kind: "proposal", spec: { ...sampleSpec, scoping: forged } } }), accept]);
    const { io: handlers, reviewed } = io([], [{ decision: "approve" }]);
    await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
    expect(reviewed[0]?.scoping).toBeUndefined();
  });

  it("carries on unreviewed when the scoper fails", async () => {
    const runtime = createFakeRuntime([() => ({ structured: { kind: "proposal", spec: bugfix } }), () => ({ ok: false })]);
    const { io: handlers, reviewed } = io([], [{ decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
    expect(result.status).toBe("approved");
    expect(reviewed[0]?.scoping).toBeUndefined();
  });
});
