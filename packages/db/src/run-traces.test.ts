import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import { findRunTrace, listRunTraces, saveRunTraceFiles } from "./run-traces";
import { createTestDatabase } from "./test-database";

let database: Database;

beforeEach(async () => {
  database = await createTestDatabase();
});

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 9, 12, 0, seconds));

describe("run traces", () => {
  it("overwrites a file on each push and adds new ones", async () => {
    await saveRunTraceFiles(database, "s1", [{ name: "s1.jsonl", text: "a" }], { now: at(0) });
    await saveRunTraceFiles(
      database,
      "s1",
      [
        { name: "s1.jsonl", text: "ab" },
        { name: "s1/subagents/agent-x.jsonl", text: "x" },
      ],
      { now: at(5) },
    );

    const found = await findRunTrace(database, "s1");
    expect(found?.files).toEqual([
      { name: "s1.jsonl", text: "ab" },
      { name: "s1/subagents/agent-x.jsonl", text: "x" },
    ]);
    expect(found?.run.startedAt).toEqual(at(0));
    expect(found?.run.lastSeenAt).toEqual(at(5));
  });

  it("keeps a known title when a later push has none", async () => {
    await saveRunTraceFiles(database, "s1", [], { title: "Fix login", now: at(0) });
    await saveRunTraceFiles(database, "s1", [], { now: at(1) });
    expect((await findRunTrace(database, "s1"))?.run.title).toBe("Fix login");
  });

  it("keeps the first format a run was stored with", async () => {
    await saveRunTraceFiles(database, "s1", [], { format: "lintcat", now: at(0) });
    await saveRunTraceFiles(database, "s1", [], { format: "otel-genai", now: at(1) });
    await saveRunTraceFiles(database, "s1", [], { now: at(2) });
    expect((await findRunTrace(database, "s1"))?.run.format).toBe("lintcat");
  });

  it("lists the most recently active run first", async () => {
    await saveRunTraceFiles(database, "old", [], { now: at(0) });
    await saveRunTraceFiles(database, "new", [], { now: at(1) });
    expect((await listRunTraces(database)).map((run) => run.runId)).toEqual(["new", "old"]);
  });

  it("returns undefined for an unknown run", async () => {
    expect(await findRunTrace(database, "missing")).toBeUndefined();
  });
});
