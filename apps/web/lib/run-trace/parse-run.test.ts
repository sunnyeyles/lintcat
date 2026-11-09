import { describe, expect, it } from "vitest";

import { assistant, jsonl, prompt, sampleRun, toolUse } from "./__fixtures__/transcripts";
import { parseRun } from "./parse-run";
import type { AgentNode } from "./types";

function find(node: AgentNode, id: string): AgentNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = find(child, id);
    if (found) return found;
  }
  return undefined;
}

describe("parseRun", () => {
  it("takes the session id and title from the main transcript", () => {
    const trace = parseRun(sampleRun());

    expect(trace.sessionId).toBe("sess-1");
    expect(trace.title).toBe("Build the feature");
    expect(trace.root).toMatchObject({ id: "sess-1", role: "main", model: "claude-test-1" });
  });

  it("nests subagents two levels deep under the calls that spawned them", () => {
    const { root } = parseRun(sampleRun());

    expect(root.children.map((c) => c.id)).toEqual(["aimpl", "arev", "alost"]);
    const implementer = find(root, "aimpl");
    expect(implementer?.children.map((c) => c.id)).toEqual(["atest"]);
    expect(implementer).toMatchObject({ role: "implementer", description: "Implement ticket" });
    expect(find(root, "atest")).toMatchObject({ role: "tester", description: "Run tests" });
  });

  it("links each spawning call to its child agent", () => {
    const { root } = parseRun(sampleRun());
    const spawned = (node: AgentNode | undefined) =>
      node?.steps.flatMap((s) => (s.kind === "tool" && s.call.childAgentId ? [s.call.childAgentId] : []));

    expect(spawned(root)).toEqual(["aimpl", "arev"]);
    expect(spawned(find(root, "aimpl"))).toEqual(["atest"]);
  });

  it("falls back to the prompt text when neither meta nor result names the agent", () => {
    const reviewer = find(parseRun(sampleRun()).root, "arev");

    expect(reviewer).toMatchObject({ role: "subagent", description: "Review" });
    expect(reviewer?.filesRead).toEqual(["src"]);
  });

  it("hangs agents no call spawned off the root rather than dropping them", () => {
    const orphan = parseRun(sampleRun()).root.children.at(-1);

    expect(orphan?.id).toBe("alost");
    expect(orphan?.steps).toEqual([{ kind: "prompt", text: "Nobody spawned me", timestamp: expect.any(String) }]);
  });

  it("makes paths relative to the main session's cwd", () => {
    const implementer = find(parseRun(sampleRun()).root, "aimpl");

    expect(implementer?.filesEdited).toEqual(["src/a.ts", "/elsewhere/b.ts"]);
  });

  it("accepts nested names and a run with no main transcript", () => {
    const files = sampleRun()
      .filter((f) => !f.name.endsWith("sess-1.jsonl"))
      .map((f) => ({ ...f, name: `sess-1/${f.name}` }));
    const { root, sessionId } = parseRun(files);

    expect(sessionId).toBe("main");
    expect(root.role).toBe("main");
    expect(find(root, "atest")).toBeDefined();
    expect(root.children.map((c) => c.id).sort()).toEqual(["aimpl", "alost", "arev"]);
  });

  it("returns an empty tree for no files or garbage", () => {
    expect(parseRun([]).root.children).toEqual([]);
    expect(parseRun([{ name: "x.jsonl", text: "garbage\n{]" }]).root.steps).toEqual([]);
  });

  it("never claims one agent for two calls", () => {
    const main = jsonl([
      assistant("m1", [
        toolUse("t1", "Agent", { prompt: "Same prompt" }),
        toolUse("t2", "Agent", { prompt: "Same prompt" }),
      ]),
    ]);
    const { root } = parseRun([
      { name: "s.jsonl", text: main },
      { name: "subagents/agent-one.jsonl", text: jsonl([prompt("Same prompt", "one")]) },
    ]);

    expect(root.children.map((c) => c.id)).toEqual(["one"]);
  });

  it("wraps several sessions of a project-shaped folder in a synthetic run root", () => {
    const first = sampleRun().map((f) => ({
      ...f,
      name: f.name.startsWith("subagents/") ? `trace/sess-1/${f.name}` : `trace/${f.name}`,
    }));
    const later = jsonl([prompt("Second session"), prompt("side", "aside")]).replaceAll("sess-1", "sess-2");
    const laterAgent = jsonl([prompt("Orphan of two", "atwo")]).replaceAll("sess-1", "sess-2");
    const trace = parseRun([
      { name: "trace/sess-2.jsonl", text: later },
      { name: "trace/sess-2.meta.json", text: "{}" },
      { name: "trace/sess-2/subagents/agent-atwo.jsonl", text: laterAgent },
      ...first,
    ]);

    expect(trace.sessionId).toBe("run");
    expect(trace.root.role).toBe("run");
    expect(trace.root.children.map((c) => c.id)).toEqual(["sess-1", "sess-2"]);
    expect(trace.root.children[0]?.description).toBe("Build the feature");
    expect(trace.root.children[0]?.children.map((c) => c.id)).toEqual(["aimpl", "arev", "alost"]);
    expect(trace.root.children[1]?.children.map((c) => c.id)).toEqual(["atwo"]);
    expect(trace.root.startedAt).toBe(trace.root.children[0]?.startedAt);
  });
});
