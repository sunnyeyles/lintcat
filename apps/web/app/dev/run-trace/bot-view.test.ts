import { describe, expect, it } from "vitest";

import { parseTrace } from "@/lib/run-trace";
import { loadFixture } from "@/lib/run-trace/adapters/fixtures/load";
import type { AgentNode, AgentStep } from "@/lib/run-trace/types";

import { botLabel, botStats, toBotView, walkBots } from "./bot-view";
import { SAMPLE_TRACE } from "./sample-trace";
import { SPARSE_TRACE } from "./sparse-trace";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();

function node(steps: AgentStep[], extra: Partial<AgentNode> = {}): AgentNode {
  return {
    id: "n",
    role: "worker",
    startedAt: at(0),
    endedAt: at(30),
    steps,
    filesRead: [],
    filesEdited: [],
    context: [],
    children: [],
    ...extra,
  };
}

const tool = (id: string, extra: Record<string, unknown> = {}): AgentStep => ({
  kind: "tool",
  call: {
    id,
    name: "Bash",
    summary: "ls",
    input: {},
    timestamp: at(5),
    result: "ok",
    ...extra,
  },
});

describe("toBotView", () => {
  it("splits steps into prompt, tools, thoughts and replies", () => {
    const bot = toBotView(
      node([
        { kind: "prompt", text: "do it", timestamp: at(0) },
        { kind: "thinking", text: "hmm", timestamp: at(1) },
        { kind: "thinking", text: "  ", timestamp: at(2) },
        tool("t1"),
        { kind: "text", text: "done", timestamp: at(9) },
      ]),
    );
    expect(bot.prompt).toBe("do it");
    expect(bot.tools.map((t) => t.id)).toEqual(["t1"]);
    expect(bot.thoughts).toHaveLength(1);
    expect(bot.said).toHaveLength(1);
    expect(bot.durationMs).toBe(30_000);
    expect(bot.status).toBe("done");
  });

  it("is running while a tool call waits on its result", () => {
    const bot = toBotView(node([tool("t1", { result: undefined, name: "Edit" })]));
    expect(bot.status).toBe("running");
    expect(bot.activeTool).toBe("Edit");
  });

  it("has failed when the last step is an errored tool call", () => {
    expect(toBotView(node([tool("t1", { isError: true })])).status).toBe("failed");
  });

  it("counts a recovered error as done", () => {
    const steps: AgentStep[] = [tool("t1", { isError: true }), { kind: "text", text: "fixed", timestamp: at(9) }];
    expect(toBotView(node(steps)).status).toBe("done");
  });

  it("leaves optional fields undefined when the source has none", () => {
    const bot = toBotView(node([], { startedAt: "", endedAt: "" }));
    expect(bot).toMatchObject({
      status: undefined,
      stage: undefined,
      costUsd: undefined,
      events: undefined,
    });
    expect(bot.peakContext).toBeUndefined();
    expect(bot.durationMs).toBeUndefined();
  });

  it("reads adapter fields when a source sets them", () => {
    const bots = [...walkBots(toBotView(SPARSE_TRACE.root))];
    expect(bots.find((b) => b.id === "p-ship")?.status).toBe("running");
    expect(bots.find((b) => b.id === "p-types")?.status).toBe("failed");
    expect(bots.find((b) => b.id === "p-lint")).toMatchObject({
      stage: "check",
      costUsd: 0.0123,
    });
  });

  it("labels a bot with only the stats it has", () => {
    const steps: AgentStep[] = [tool("t1"), tool("t2")];
    expect(botLabel(toBotView(node(steps, { description: "Implement MRW-41" })), "implementer")).toBe(
      "implementer: Implement MRW-41, 30s, 2 tools",
    );
    const bare = toBotView(node([], { startedAt: "", endedAt: "" }));
    expect(botStats(bare)).toEqual([]);
    expect(botLabel(bare, "lint")).toBe("lint");
  });

  it("keeps the whole sample tree", () => {
    const root = toBotView(SAMPLE_TRACE.root);
    expect([...walkBots(root)]).toHaveLength(10);
    expect(root.peakContext).toBeGreaterThan(0);
  });
});

describe("toBotView over adapter output", () => {
  it("passes status, stage, costUsd and events through from the factory adapter", () => {
    const { trace } = parseTrace(loadFixture("lintcat-factory"));
    const bots = [...walkBots(toBotView(trace.root))];
    expect(bots[0]).toMatchObject({ status: "failed", costUsd: 0.62 });
    const implementer = bots.find((bot) => bot.id === "agent:verify/implementer");
    expect(implementer).toMatchObject({ status: "failed", stage: "verify", costUsd: 0.08 });
    expect(implementer?.events?.map((event) => [event.kind, event.ok])).toEqual([
      ["command", false],
      ["error", false],
    ]);
  });
});
