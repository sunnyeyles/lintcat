import { gzipSync } from "node:zlib";

import type { Database } from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { beforeEach, describe, expect, it } from "vitest";

import { loadFixture } from "@/lib/run-trace/adapters/fixtures/load";
import type { RunTraceConnector } from "@/lib/run-trace/connectors/types";

import {
  handleRunTraceIngest,
  handleRunTraceList,
  handleRunTraceRead,
  isSafeFileName,
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

function post(body: unknown, { token = TOKEN, gzip = false, runId = "s1" } = {}): Request {
  const json = JSON.stringify(body);
  return new Request(`https://lintcat.test/api/run-trace/${runId}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(gzip ? { "content-encoding": "gzip" } : {}),
    },
    body: gzip ? gzipSync(json) : json,
  });
}

const get = (token = TOKEN, path = "s1") =>
  new Request(`https://lintcat.test/api/run-trace/${path}`, { headers: { authorization: `Bearer ${token}` } });

const LINTCAT = loadFixture("lintcat").map((file) => ({ ...file, name: "run.ndjson" }));
const OTEL = loadFixture("otel-genai").map((file) => ({ ...file, name: "spans.json" }));

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

describe("generalised ingest", () => {
  it("auto-detects the format and stores it with the run", async () => {
    const response = await handleRunTraceIngest(post({ files: LINTCAT }, { runId: "r1" }), "r1", deps);
    expect(await response.json()).toEqual({ ok: true, format: "lintcat", files: 1 });
    const read = (await (await handleRunTraceRead(get(TOKEN, "r1"), "r1", deps)).json()) as {
      run: { format: string; title: string; source: string };
    };
    expect(read.run).toMatchObject({ format: "lintcat", title: "Refresh API docs", source: "push" });
  });

  it("takes an explicit format", async () => {
    const response = await handleRunTraceIngest(post({ format: "otel-genai", files: OTEL }, { runId: "r2" }), "r2", deps);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { format: string }).format).toBe("otel-genai");
  });

  it("falls back to the run's stored format for a chunk it cannot detect", async () => {
    await handleRunTraceIngest(post({ files: LINTCAT }, { runId: "r3" }), "r3", deps);
    const chunk = [{ name: "run-2.ndjson", text: "" }];
    const response = await handleRunTraceIngest(post({ files: chunk }, { runId: "r3" }), "r3", deps);
    expect(((await response.json()) as { format: string }).format).toBe("lintcat");
  });

  it("rejects an unknown format and lists what is supported", async () => {
    const response = await handleRunTraceIngest(post({ format: "nope", files: LINTCAT }, { runId: "r4" }), "r4", deps);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; supported: string[] };
    expect(body.error).toBe('unknown format "nope"');
    expect(body.supported).toContain("otel-genai");
  });

  it("rejects files it cannot detect", async () => {
    const files = [{ name: "notes.json", text: '{"hello":1}' }];
    const response = await handleRunTraceIngest(post({ files }, { runId: "r5" }), "r5", deps);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { supported: string[] }).supported).toHaveLength(5);
  });

  it("answers 413 to an oversized body", async () => {
    const small = { ...deps, maxBodyBytes: 1024 };
    const response = await handleRunTraceIngest(post({ files: LINTCAT }, { runId: "r6" }), "r6", small);
    expect(response.status).toBe(413);
  });

  it("answers 404 to a bad token for any format", async () => {
    const response = await handleRunTraceIngest(post({ files: OTEL }, { token: "nope", runId: "r7" }), "r7", deps);
    expect(response.status).toBe(404);
  });

  it("rejects unsafe file names for generic formats", async () => {
    const files = [{ name: "../escape.ndjson", text: LINTCAT[0]!.text }];
    expect((await handleRunTraceIngest(post({ files }, { runId: "r8" }), "r8", deps)).status).toBe(400);
  });
});

describe("connectors", () => {
  const connector: RunTraceConnector = {
    id: "factory",
    label: "Factory",
    list: async () => [
      { runId: "f1", title: "Pulled", format: "lintcat-factory", startedAt: new Date(0), lastSeenAt: new Date("2030-01-01") },
    ],
    read: async (runId) =>
      runId === "f1"
        ? { run: { runId, title: "Pulled", format: "lintcat-factory", startedAt: new Date(0), lastSeenAt: new Date(0) }, files: [] }
        : undefined,
  };

  it("lists pulled runs beside pushed ones, newest first", async () => {
    await handleRunTraceIngest(post({ files: [{ name: "s1.jsonl", text: MAIN }] }), "s1", deps);
    const body = (await (await handleRunTraceList(get(), { ...deps, connectors: [connector] })).json()) as {
      runs: { runId: string; source: string }[];
      sources: string[];
    };
    expect(body.runs.map((run) => [run.runId, run.source])).toEqual([["f1", "factory"], ["s1", "push"]]);
    expect(body.sources).toEqual(["push", "factory"]);
  });

  it("reports a failing connector without failing the list", async () => {
    const broken: RunTraceConnector = { ...connector, list: () => Promise.reject(new Error("db down")) };
    const body = (await (await handleRunTraceList(get(), { ...deps, connectors: [broken] })).json()) as {
      errors: { source: string; error: string }[];
    };
    expect(body.errors).toEqual([{ source: "factory", error: "db down" }]);
  });

  it("still lists pulled runs when the push database is unreachable", async () => {
    const database = {
      select: () => {
        throw new Error("no DATABASE_URL");
      },
    } as unknown as Database;
    const body = (await (await handleRunTraceList(get(), { ...deps, database, connectors: [connector] })).json()) as {
      runs: { runId: string }[];
      errors: { source: string }[];
    };
    expect(body.runs.map((run) => run.runId)).toEqual(["f1"]);
    expect(body.errors.map((error) => error.source)).toEqual(["push"]);
  });

  it("reads a pulled run by source, and 404s an unknown source", async () => {
    const withConnector = { ...deps, connectors: [connector] };
    expect((await handleRunTraceRead(get(TOKEN, "f1?source=factory"), "f1", withConnector)).status).toBe(200);
    expect((await handleRunTraceRead(get(TOKEN, "f1?source=elsewhere"), "f1", withConnector)).status).toBe(404);
    expect((await handleRunTraceRead(get(TOKEN, "f2?source=factory"), "f2", withConnector)).status).toBe(404);
  });
});

describe("isSafeFileName", () => {
  it.each([
    ["run.ndjson", true],
    ["traces/otel.json", true],
    [".factory/runs/r1/events.jsonl", true],
    ["../x.json", false],
    ["a/../b.json", false],
    ["/etc/passwd.json", false],
    ["run.sh", false],
    ["a/b/c/d/e/f.json", false],
  ])("%s → %s", (name, ok) => {
    expect(isSafeFileName(name)).toBe(ok);
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
