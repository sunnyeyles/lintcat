import { gzipSync } from "node:zlib";

import type { Database } from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { beforeEach, describe, expect, it } from "vitest";

import {
  handleRunTraceIngest,
  handleRunTraceList,
  handleRunTraceRead,
  isTraceFileName,
  type RunTraceDeps,
} from "./handler";

const TOKEN = "secret-token";
const MAIN = JSON.stringify({
  type: "user",
  sessionId: "s1",
  timestamp: "2026-11-09T12:00:00Z",
  message: { role: "user", content: "Fix the login bug" },
});

let deps: RunTraceDeps;

beforeEach(async () => {
  const database: Database = await createTestDatabase();
  deps = { database, token: TOKEN, now: () => new Date("2026-11-09T12:00:00Z") };
});

function post(body: unknown, { token = TOKEN, gzip = false } = {}): Request {
  const json = JSON.stringify(body);
  return new Request("https://lintcat.test/api/run-trace/s1", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(gzip ? { "content-encoding": "gzip" } : {}),
    },
    body: gzip ? gzipSync(json) : json,
  });
}

const get = (token = TOKEN) =>
  new Request("https://lintcat.test/api/run-trace/s1", { headers: { authorization: `Bearer ${token}` } });

describe("run trace API", () => {
  it("stores pushed files and reads them back", async () => {
    const files = [
      { name: "s1.jsonl", text: MAIN },
      { name: "s1/subagents/agent-a1.meta.json", text: "{}" },
    ];
    expect((await handleRunTraceIngest(post({ files }), "s1", deps)).status).toBe(200);

    const read = await handleRunTraceRead(get(), "s1", deps);
    const body = (await read.json()) as { files: unknown; run: { title: string | null } };
    expect(body.files).toEqual(files);

    const list = (await (await handleRunTraceList(get(), deps)).json()) as { runs: { runId: string }[] };
    expect(list.runs.map((run) => run.runId)).toEqual(["s1"]);
  });

  it("accepts a gzipped body", async () => {
    const files = [{ name: "s1.jsonl", text: MAIN }];
    expect((await handleRunTraceIngest(post({ files }, { gzip: true }), "s1", deps)).status).toBe(200);
  });

  it("answers 404 to a wrong or unconfigured token", async () => {
    const files = [{ name: "s1.jsonl", text: MAIN }];
    expect((await handleRunTraceIngest(post({ files }, { token: "nope" }), "s1", deps)).status).toBe(404);
    expect((await handleRunTraceRead(get("nope"), "s1", deps)).status).toBe(404);
    expect((await handleRunTraceList(get(), { ...deps, token: undefined })).status).toBe(404);
  });

  it("rejects files outside the run's transcript layout", async () => {
    const files = [{ name: "../etc/passwd", text: "x" }];
    expect((await handleRunTraceIngest(post({ files }), "s1", deps)).status).toBe(400);
  });

  it("answers 404 for an unknown run", async () => {
    expect((await handleRunTraceRead(get(), "missing", deps)).status).toBe(404);
  });
});

describe("isTraceFileName", () => {
  it.each([
    ["s1.jsonl", true],
    ["s1/subagents/agent-abc.jsonl", true],
    ["s1/subagents/agent-abc.meta.json", true],
    ["s2.jsonl", false],
    ["s1/subagents/../x.jsonl", false],
    ["s1/other/agent-abc.jsonl", false],
  ])("%s → %s", (name, ok) => {
    expect(isTraceFileName("s1", name)).toBe(ok);
  });
});
