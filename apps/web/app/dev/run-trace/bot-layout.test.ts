import { describe, expect, it } from "vitest";

import type { AgentNode } from "@/lib/run-trace/types";

import { isFlat, layoutBots, type TreeBox } from "./bot-layout";
import { toBotView } from "./bot-view";
import { SAMPLE_TRACE } from "./sample-trace";
import { SPARSE_TRACE } from "./sparse-trace";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();

function node(id: string, start: number, end: number, children: AgentNode[] = [], work = true): AgentNode {
  return {
    id,
    role: "worker",
    startedAt: at(start),
    endedAt: at(end),
    steps: work
      ? [
          {
            kind: "tool",
            call: {
              id: `${id}-t`,
              name: "Read",
              summary: "a",
              input: {},
              timestamp: at(start),
              result: "x",
            },
          },
        ]
      : [],
    filesRead: [],
    filesEdited: [],
    context: [],
    children,
  };
}

const ids = (wave: TreeBox[]) => wave.map((b) => b.bot.id);

describe("layoutBots: tree", () => {
  it("puts parallel siblings in one wave and sequential ones in the next", () => {
    const root = node("root", 0, 100, [node("c", 50, 60), node("a", 0, 20), node("b", 10, 30), node("d", 60, 70)]);
    const floor = layoutBots(toBotView(root));
    if (floor.kind !== "tree") throw new Error("expected a tree");
    expect(floor.root.waves.map(ids)).toEqual([["a", "b"], ["c"], ["d"]]);
  });

  it("nests grandchildren under the agent that spawned them", () => {
    const root = node("root", 0, 100, [node("a", 0, 50, [node("a1", 1, 2), node("a2", 1, 3)])]);
    const floor = layoutBots(toBotView(root));
    if (floor.kind !== "tree") throw new Error("expected a tree");
    expect(floor.root.waves[0][0].waves.map(ids)).toEqual([["a1", "a2"]]);
  });

  it("lays the sample out as a tree with the parallel ticket agents side by side", () => {
    const floor = layoutBots(toBotView(SAMPLE_TRACE.root));
    if (floor.kind !== "tree") throw new Error("expected a tree");
    expect(floor.root.bot.role).toBe("main");
    expect(floor.root.waves.map((w) => w.length)).toEqual([1, 4, 2, 1, 1]);
  });

  it("shows a lone agent as a one-bot tree", () => {
    const floor = layoutBots(toBotView(node("solo", 0, 1)));
    expect(floor).toMatchObject({
      kind: "tree",
      root: { bot: { id: "solo" }, waves: [] },
    });
  });
});

describe("layoutBots: flat", () => {
  it("groups the sparse fixture by stage, left to right by start", () => {
    const floor = layoutBots(toBotView(SPARSE_TRACE.root));
    if (floor.kind !== "flat") throw new Error("expected flat");
    expect(floor.lanes.map((l) => [l.stage, l.bots.map((b) => b.id)])).toEqual([
      ["plan", ["p-plan"]],
      ["check", ["p-lint", "p-types"]],
      ["test", ["p-test"]],
      ["ship", ["p-ship"]],
    ]);
  });

  it("treats a workless root over leaf agents as flat, without stages", () => {
    const root = toBotView(node("root", 0, 10, [node("b", 5, 6), node("a", 1, 2)], false));
    expect(isFlat(root)).toBe(true);
    const floor = layoutBots(root);
    if (floor.kind !== "flat") throw new Error("expected flat");
    expect(floor.lanes).toHaveLength(1);
    expect(floor.lanes[0].bots.map((b) => b.id)).toEqual(["a", "b"]);
  });
});
