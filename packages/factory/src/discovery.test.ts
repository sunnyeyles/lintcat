import { createFakeRuntime } from "@pr-review/agent-runtime";
import { describe, expect, it } from "vitest";

import { sampleSpec } from "#src/test-fixtures";
import { runDiscovery, type DiscoveryIO } from "#src/discovery";

const io = (answers: string[], decisions: Awaited<ReturnType<DiscoveryIO["review"]>>[]) => {
  const asked: string[] = [];
  const reviewed: string[] = [];
  return {
    asked,
    reviewed,
    io: {
      ask: async (turn) => {
        asked.push(turn.question);
        return answers.shift() ?? "no preference";
      },
      review: async (spec) => {
        reviewed.push(spec.title);
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
});
