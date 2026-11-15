import { describe, expect, it } from "vitest";

import { factoryAdapter } from "@/lib/run-trace/adapters/factory";
import { loadFixture } from "@/lib/run-trace/adapters/fixtures/load";

const line = (kind: string, extra: object = {}) =>
  JSON.stringify({ at: "2026-11-10T09:00:00Z", taskId: "t", runId: "r1", kind, toolVersion: "factory@0.1.0", data: {}, ...extra });

describe("factoryAdapter", () => {
  it("detects an export and a .factory events.jsonl", () => {
    expect(factoryAdapter.detect(loadFixture("lintcat-factory"))).toBe(0.95);
    expect(factoryAdapter.detect([{ name: ".factory/runs/r1/events.jsonl", text: line("run_started") }])).toBe(0.9);
    expect(factoryAdapter.detect(loadFixture("lintcat"))).toBe(0);
  });

  it("puts stages under the run and agents under their stage, with commands and checks as events", () => {
    const trace = factoryAdapter.parse(loadFixture("lintcat-factory"));
    expect(trace).toMatchObject({
      sessionId: "run_01JC8Z5Q3K",
      title: "Retry flaky webhook delivery",
      outcome: { status: "failed", blocker: "pnpm test still fails after 2 repair passes" },
    });
    expect(trace.root).toMatchObject({ role: "factory", status: "failed", costUsd: 0.62 });
    expect(trace.root.children.map((c) => c.role)).toEqual(["prepare", "reproduce", "implement", "verify"]);

    const verify = trace.root.children[3]!;
    expect(verify.status).toBe("failed");
    const implementer = verify.children[0]!;
    expect(implementer).toMatchObject({ role: "implementer", stage: "verify", status: "failed", costUsd: 0.08 });
    expect(implementer.startedAt).toBe("2026-11-10T09:05:10.000Z");
    expect(implementer.events?.map((e) => [e.kind, e.ok])).toEqual([
      ["command", false],
      ["error", false],
    ]);
    expect(implementer.events?.[1]?.label).toBe("max_turns");
    const checks = (verify.events ?? []).flatMap((e) => (e.kind === "check" ? [`${e.label.split(":")[0]}:${e.ok}`] : []));
    expect(checks).toEqual(["lint:true", "test:false", "checks_finished:false"]);
  });

  it("reads an events.jsonl folder with its task.md title", () => {
    const events = [
      line("run_started"),
      line("agent_finished", { stage: "plan", agentId: "planner", data: { ok: true, durationMs: 1000 } }),
    ];
    const trace = factoryAdapter.parse([
      { name: "r1/events.jsonl", text: events.join("\n") },
      { name: "r1/task.md", text: "# Add retries\n\nbody" },
    ]);
    expect(trace).toMatchObject({ sessionId: "r1", title: "Add retries" });
    expect(trace.root.children[0]?.children[0]).toMatchObject({ role: "planner", status: "done" });
  });
});
