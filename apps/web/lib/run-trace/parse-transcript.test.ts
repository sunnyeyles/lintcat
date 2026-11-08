import { describe, expect, it } from "vitest";

import { assistant, CWD, jsonl, prompt, sampleRun, toolResult, toolUse } from "./__fixtures__/transcripts";
import { parseTranscript, RESULT_MAX } from "./parse-transcript";

function mainText(): string {
  return sampleRun()[0]?.text ?? "";
}

describe("parseTranscript", () => {
  it("orders prompt, thinking, text and tool steps as they happened", () => {
    const { node } = parseTranscript(mainText(), { id: "m", role: "main" });

    expect(node.steps.map((s) => s.kind)).toEqual(["prompt", "thinking", "tool", "text", "tool", "tool", "text"]);
    expect(node.steps[1]).toMatchObject({ kind: "thinking", text: "Read a.ts first." });
  });

  it("skips meta and system-reminder user lines", () => {
    const { node } = parseTranscript(
      jsonl([prompt("<system-reminder>\nnoise</system-reminder>"), prompt("real")]),
      { id: "m", role: "main" },
    );

    expect(node.steps).toEqual([{ kind: "prompt", text: "real", timestamp: expect.any(String) }]);
  });

  it("counts a streamed message's usage once", () => {
    const { node } = parseTranscript(mainText(), { id: "m", role: "main" });

    expect(node.context).toHaveLength(4);
    expect(node.context[0]).toEqual({ timestamp: expect.any(String), tokens: 10003, outputTokens: 120 });
    expect(node.context[1]?.tokens).toBe(1502);
  });

  it("keeps the larger usage when a later streamed line reports more", () => {
    const { node } = parseTranscript(
      jsonl([
        assistant("m1", [{ type: "text", text: "a" }], {
          input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1,
        }),
        assistant("m1", [{ type: "text", text: "b" }], {
          input_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 30,
        }),
      ]),
      { id: "m", role: "main" },
    );

    expect(node.context.map((c) => c.outputTokens)).toEqual([30]);
    expect(node.steps.map((s) => (s.kind === "text" ? s.text : ""))).toEqual(["a", "b"]);
  });

  it("drops a block repeated verbatim across streamed lines", () => {
    const block = toolUse("t1", "Bash", { command: "ls" });
    const { node } = parseTranscript(
      jsonl([assistant("m1", [{ type: "text", text: "hi" }, block]), assistant("m1", [{ type: "text", text: "hi" }, block])]),
      { id: "m", role: "main" },
    );

    expect(node.steps.map((s) => s.kind)).toEqual(["text", "tool"]);
  });

  it("attaches results to calls, truncated, with errors flagged", () => {
    const tester = sampleRun().find((f) => f.name.includes("atest.jsonl"))?.text ?? "";
    const step = parseTranscript(tester, { id: "t", role: "tester" }).node.steps[1];

    expect(step?.kind).toBe("tool");
    if (step?.kind !== "tool") return;
    expect(step.call).toMatchObject({ name: "Bash", summary: "pnpm test", isError: true });
    expect(step.call.result).toHaveLength(RESULT_MAX + 1);
  });

  it("reports spawned agent ids from toolUseResult or the result text", () => {
    const implementer = sampleRun().find((f) => f.name.includes("aimpl.jsonl"))?.text ?? "";

    expect([...parseTranscript(mainText(), { id: "m", role: "main" }).spawned]).toEqual([["toolu_impl", "aimpl"]]);
    expect([...parseTranscript(implementer, { id: "i", role: "x" }).spawned]).toEqual([["toolu_test", "atest"]]);
  });

  it("records files read and edited relative to the cwd, once each", () => {
    const text = jsonl([
      assistant("m1", [
        toolUse("r1", "Read", { file_path: `${CWD}/a.ts` }),
        toolUse("r2", "Read", { file_path: `${CWD}/a.ts` }),
        toolUse("g1", "Glob", { pattern: "**/*.ts" }),
        toolUse("e1", "NotebookEdit", { notebook_path: `${CWD}/n.ipynb` }),
      ]),
      toolResult("r1", "x"),
    ]);
    const { node } = parseTranscript(text, { id: "m", role: "main" });

    expect(node.filesRead).toEqual(["a.ts"]);
    expect(node.filesEdited).toEqual(["n.ipynb"]);
  });

  it("skips sidechain lines in the main transcript and survives malformed ones", () => {
    const text = jsonl([prompt("main"), prompt("side", "a1"), "{bad", "[1,2]", "null", '{"type":"assistant","message":42}']);
    const { node } = parseTranscript(text, { id: "m", role: "main", skipSidechain: true });

    expect(node.steps.map((s) => (s.kind === "prompt" ? s.text : ""))).toEqual(["main"]);
    expect(node.startedAt <= node.endedAt).toBe(true);
  });
});
