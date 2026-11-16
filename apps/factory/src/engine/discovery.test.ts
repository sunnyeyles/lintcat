import { createFakeRuntime } from "#src/agent/fake-runtime";
import { describe, expect, it } from "vitest";

import { sampleSpec } from "#src/engine/test-fixtures";
import { runDiscovery, type DiscoveryIO } from "#src/engine/discovery";

const io = (answers: string[], decisions: Awaited<ReturnType<DiscoveryIO["review"]>>[]) => {
  const asked: string[] = [];
  const reviewed: string[] = [];
  const versions: string[] = [];
  return {
    asked,
    reviewed,
    versions,
    io: {
      ask: async (turn) => {
        asked.push(turn.question);
        return answers.shift() ?? "no preference";
      },
      review: async (spec, promptVersion) => {
        reviewed.push(spec.title);
        versions.push(promptVersion);
        return decisions.shift() ?? { decision: "abort" };
      },
    } satisfies DiscoveryIO,
  };
};

const accept = () => ({ structured: { verdict: "accept", reason: "a genuine one-off", evidence: [], followUps: [] } });
const change = () => ({
  structured: {
    verdict: "change",
    category: "refactor",
    reason: "the same defect sits at three call sites",
    evidence: ["src/a.ts:10 parses by hand", "src/b.ts:22 parses by hand"],
    followUps: [],
  },
});
const propose = (spec: object = sampleSpec) => () => ({ structured: { kind: "proposal", spec } });

describe("runDiscovery", () => {
  it("asks one question at a time, then gets one approval, resuming one session", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "question", question: "Which flag name?", facts: ["CLI in src/cli.ts"] } }),
      propose(),
      accept,
    ]);
    const { io: handlers, asked, versions } = io(["--version"], [{ decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "add a version flag", io: handlers });
    expect(result.status).toBe("approved");
    expect(result).not.toHaveProperty("spec.scoping");
    expect(asked).toEqual(["Which flag name?"]);
    expect(runtime.specs.map((s) => [s.role, s.readOnly])).toEqual([
      ["discovery", true],
      ["discovery", true],
      ["scoper", true],
    ]);
    expect(runtime.specs[1]?.resumeSessionId).toBe("fake-session-1");
    expect(runtime.specs[1]?.prompt).toBe("Answer: --version");
    expect(runtime.specs[2]?.resumeSessionId).toBeUndefined();
    expect(versions[0]).toMatch(/^discovery@/);
  });

  it("sends revision feedback and re-asks for a schema-valid answer", async () => {
    const runtime = createFakeRuntime([
      () => ({ structured: { kind: "proposal" } }),
      propose(),
      accept,
      propose({ ...sampleSpec, title: "Add --version and -v" }),
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
    const runtime = createFakeRuntime([question, question, propose(), accept]);
    const { io: handlers } = io([], [{ decision: "abort" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers, maxQuestions: 1 });
    expect(result.status).toBe("aborted");
    expect(runtime.specs[2]?.prompt).toMatch(/No more questions/);
  });

  it("resumes discovery with a scoping change and records it as applied", async () => {
    const runtime = createFakeRuntime([propose(), change, propose({ ...sampleSpec, category: "refactor" })]);
    const { io: handlers, versions } = io([], [{ decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
    expect(result).toMatchObject({
      status: "approved",
      spec: { category: "refactor", scoping: { verdict: "change", from: "quick", proposed: "refactor", applied: true } },
    });
    const resumed = runtime.specs[2];
    expect(resumed?.role).toBe("discovery");
    expect(resumed?.resumeSessionId).toBe("fake-session-1");
    expect(resumed?.prompt).toContain("- src/a.ts:10 parses by hand");
    expect(versions[0]).toMatch(/^discovery@/);
    expect(result.status === "approved" && result.spec.scoping?.promptVersion).toMatch(/^scoper@/);
  });

  it("records a rebuttal and scopes only once across later revisions", async () => {
    const runtime = createFakeRuntime([propose(), change, propose(), propose({ ...sampleSpec, title: "Revised" })]);
    const { io: handlers } = io([], [{ decision: "revise", feedback: "rename" }, { decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
    expect(result).toMatchObject({ status: "approved", spec: { title: "Revised", scoping: { applied: false } } });
    expect(runtime.specs.filter((s) => s.role === "scoper")).toHaveLength(1);
  });

  it("drops a scoping record the discovery agent forged", async () => {
    const forged = { verdict: "change", from: "bugfix", proposed: "quick", reason: "x", evidence: [], followUps: [], applied: true, promptVersion: "x" };
    const runtime = createFakeRuntime([propose({ ...sampleSpec, scoping: forged }), accept]);
    const { io: handlers } = io([], [{ decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
    expect(result.status === "approved" && result.spec.scoping).toBeUndefined();
  });

  it("leaves the spec without a record when the scoper fails", async () => {
    const runtime = createFakeRuntime([propose(), () => ({ ok: false })]);
    const { io: handlers } = io([], [{ decision: "approve" }]);
    const result = await runDiscovery({ runtime, repoPath: "/repo", outcome: "x", io: handlers });
    expect(result.status).toBe("approved");
    expect(result.status === "approved" && result.spec.scoping).toBeUndefined();
  });
});
