import { describe, expect, it } from "vitest";

import type { AgentNode } from "@/lib/run-trace/types";

import { SAMPLE_TRACE } from "./sample-trace";
import {
  agentStats,
  ancestorIds,
  axisTicks,
  barSpan,
  findAgent,
  formatDuration,
  fraction,
  roleColor,
  timeBounds,
  visibleRows,
} from "./trace-layout";

const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();

function node(id: string, start: number, end: number, children: AgentNode[] = []): AgentNode {
  return {
    id,
    role: id === "root" ? "main" : "worker",
    startedAt: at(start),
    endedAt: at(end),
    steps: [
      { kind: "prompt", text: "go", timestamp: at(start) },
      { kind: "tool", call: { id: `${id}-t`, name: "Read", summary: "a.ts", input: {}, timestamp: at(start) } },
    ],
    filesRead: [],
    filesEdited: [],
    context: [
      { timestamp: at(start), tokens: 10, outputTokens: 1 },
      { timestamp: at(end), tokens: 30, outputTokens: 1 },
    ],
    children,
  };
}

const tree = node("root", 0, 100, [node("b", 40, 60), node("a", 10, 50, [node("a1", 20, 30)])]);

describe("visibleRows", () => {
  it("walks depth-first with children ordered by start", () => {
    expect(visibleRows(tree, new Set()).map((r) => [r.node.id, r.depth])).toEqual([
      ["root", 0],
      ["a", 1],
      ["a1", 2],
      ["b", 1],
    ]);
  });

  it("hides the descendants of a collapsed agent", () => {
    const rows = visibleRows(tree, new Set(["a"]));
    expect(rows.map((r) => r.node.id)).toEqual(["root", "a", "b"]);
    expect(rows[1]).toMatchObject({ collapsed: true, hasChildren: true });
  });
});

describe("time scaling", () => {
  const bounds = timeBounds(tree);

  it("spans the earliest start to the latest end", () => {
    expect(bounds.end - bounds.start).toBe(100_000);
  });

  it("places bars as fractions of the run", () => {
    expect(barSpan(findAgent(tree, "a")!, bounds)).toEqual({ left: 0.1, width: 0.4 });
  });

  it("clamps outside the run", () => {
    expect(fraction(bounds.start - 5, bounds)).toBe(0);
    expect(fraction(bounds.end + 5, bounds)).toBe(1);
  });

  it("picks round tick steps", () => {
    expect(axisTicks(bounds, 8)).toEqual([0, 15_000, 30_000, 45_000, 60_000, 75_000, 90_000]);
    expect(axisTicks({ start: 0, end: 3 * 3_600_000 }, 8)).toEqual([0, 1_800_000, 3_600_000, 5_400_000, 7_200_000, 9_000_000, 10_800_000]);
  });
});

describe("agent stats", () => {
  it("counts tools, duration and peak context", () => {
    expect(agentStats(tree)).toEqual({ durationMs: 100_000, toolCount: 1, eventCount: 0, peakContext: 30 });
  });

  it("finds the path to an agent", () => {
    expect(ancestorIds(tree, "a1")).toEqual(["root", "a"]);
    expect(ancestorIds(tree, "missing")).toEqual([]);
  });
});

describe("format and colour", () => {
  it("formats durations", () => {
    expect(formatDuration(42_000)).toBe("42s");
    expect(formatDuration(125_000)).toBe("2m 05s");
    expect(formatDuration(3_900_000)).toBe("1h 05m");
  });

  it("gives every role a token colour and main the first", () => {
    expect(roleColor("main")).toBe("var(--chart-1)");
    expect(roleColor("marrow-reviewer")).toMatch(/^var\(--chart-[2-5]\)$/);
  });
});

describe("sample trace", () => {
  it("nests every child inside its parent's span and links spawns", () => {
    for (const parent of visibleRows(SAMPLE_TRACE.root, new Set()).map((r) => r.node)) {
      for (const child of parent.children) {
        expect(Date.parse(child.startedAt)).toBeGreaterThanOrEqual(Date.parse(parent.startedAt));
        expect(Date.parse(child.endedAt)).toBeLessThanOrEqual(Date.parse(parent.endedAt));
        const spawn = parent.steps.find((s) => s.kind === "tool" && s.call.childAgentId === child.id);
        expect(spawn).toBeDefined();
      }
    }
  });
});
