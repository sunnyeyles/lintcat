import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sampleRun } from "./__fixtures__/transcripts";
import { loadRunDir } from "./load-run-dir";

describe("loadRunDir", () => {
  let project: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "run-trace-"));
    await mkdir(join(project, "sess-1", "subagents"), { recursive: true });
    for (const file of sampleRun()) {
      const path = file.name.startsWith("subagents/") ? join(project, "sess-1", file.name) : join(project, file.name);
      await writeFile(path, file.text);
    }
    await writeFile(join(project, "sess-1", "ccr-tip.json"), "{}");
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it.each([
    ["the main transcript", "sess-1.jsonl"],
    ["the session directory", "sess-1"],
  ])("loads a run from %s", async (_label, entry) => {
    const trace = await loadRunDir(join(project, entry));

    expect(trace.sessionId).toBe("sess-1");
    expect(trace.root.children.map((c) => c.id)).toEqual(["aimpl", "arev", "alost"]);
    expect(trace.root.children[0]?.children.map((c) => c.id)).toEqual(["atest"]);
  });

  it("loads every session from a project-shaped folder", async () => {
    await writeFile(join(project, "sess-2.jsonl"), JSON.stringify({ type: "user", sessionId: "sess-2", timestamp: "2027-01-01T00:00:00.000Z", message: { content: "hi" } }));
    const trace = await loadRunDir(project);

    expect(trace.root.role).toBe("run");
    expect(trace.root.children.map((c) => c.id)).toEqual(["sess-1", "sess-2"]);
    expect(trace.root.children[0]?.children[0]?.children.map((c) => c.id)).toEqual(["atest"]);
  });
});
