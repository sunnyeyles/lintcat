import { appendEvent, createRun, recordCommand, type FactoryDatabase } from "@pr-review/factory/store";
import { createTestFactoryDatabase } from "@pr-review/factory/test-store";
import { beforeAll, describe, expect, it } from "vitest";

import { parseTrace } from "@/lib/run-trace";
import { factoryConnector, factoryConnectorFromEnv } from "@/lib/run-trace/connectors/factory";

let database: FactoryDatabase;

beforeAll(async () => {
  database = await createTestFactoryDatabase();
  const contract = {} as Parameters<typeof createRun>[1]["contract"];
  await createRun(database, { id: "run_a", repoPath: "/repo", title: "Add retries", contract });
  await appendEvent(database, { runId: "run_a", kind: "run_started", data: { attempt: 1 } });
  await appendEvent(database, {
    runId: "run_a",
    kind: "agent_finished",
    stage: "implement",
    agentId: "implementer",
    data: { ok: true, durationMs: 1000, usage: { inputTokens: 10, outputTokens: 2 } },
  });
  await recordCommand(database, {
    runId: "run_a",
    stage: "verify",
    name: "test",
    command: "pnpm test",
    cwd: "/workspace",
    startedAt: new Date(),
    durationMs: 1200,
    exitCode: 1,
    timedOut: false,
    outputHash: "h",
    output: "x".repeat(20_000),
  });
}, 30_000);

describe("factoryConnector", () => {
  it("is off without FACTORY_DATABASE_URL", () => {
    expect(factoryConnectorFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("lists runs with their latest activity", async () => {
    const runs = await factoryConnector(database).list(10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runId: "run_a", title: "Add retries", format: "lintcat-factory" });
  });

  it("reads a run into a file the factory adapter parses", async () => {
    const found = await factoryConnector(database).read("run_a");
    expect(found?.files.map((f) => f.name)).toEqual(["factory-run.json"]);
    const { trace, adapter } = parseTrace(found!.files);
    expect(adapter.id).toBe("lintcat-factory");
    expect(trace.title).toBe("Add retries");
    expect(trace.root.children.map((c) => c.role)).toEqual(["implement", "verify"]);
    expect(trace.root.children[1]!.events?.[0]).toMatchObject({ kind: "check", label: "test: $ pnpm test → exit 1", ok: false });
  });

  it("answers undefined for an unknown run", async () => {
    expect(await factoryConnector(database).read("missing")).toBeUndefined();
  });
});
