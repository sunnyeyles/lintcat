import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { changedFiles, DEBOUNCE_MS, listTraceFiles, shouldSend } from "./run-trace-push.mjs";

describe("run-trace-push", () => {
  it("sends only files whose mtime moved since the last send", () => {
    const entries = [
      { name: "s.jsonl", mtimeMs: 2 },
      { name: "s/subagents/agent-a.jsonl", mtimeMs: 5 },
      { name: "s/subagents/agent-b.jsonl", mtimeMs: 7 },
    ];
    const sent = { "s.jsonl": 1, "s/subagents/agent-a.jsonl": 5 };
    expect(changedFiles(entries, sent).map((e) => e.name)).toEqual([
      "s.jsonl",
      "s/subagents/agent-b.jsonl",
    ]);
  });

  it("debounces tool calls but always sends when an agent stops", () => {
    expect(shouldSend("PostToolUse", 1000, 1000 + DEBOUNCE_MS - 1)).toBe(false);
    expect(shouldSend("PostToolUse", 1000, 1000 + DEBOUNCE_MS)).toBe(true);
    expect(shouldSend("Stop", 1000, 1001)).toBe(true);
    expect(shouldSend("SubagentStop", 1000, 1001)).toBe(true);
  });

  it("lists the main transcript and its subagent files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "run-trace-"));
    const subagents = path.join(dir, "s", "subagents");
    await mkdir(subagents, { recursive: true });
    await writeFile(path.join(dir, "s.jsonl"), "{}");
    await writeFile(path.join(subagents, "agent-a.jsonl"), "{}");
    await writeFile(path.join(subagents, "agent-a.meta.json"), "{}");
    await writeFile(path.join(subagents, "notes.txt"), "x");

    const files = await listTraceFiles(path.join(dir, "s.jsonl"), "s");
    expect(files.map((f) => f.name)).toEqual([
      "s.jsonl",
      "s/subagents/agent-a.jsonl",
      "s/subagents/agent-a.meta.json",
    ]);
  });
});
