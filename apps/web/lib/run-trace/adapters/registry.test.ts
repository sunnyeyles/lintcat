import { describe, expect, it } from "vitest";

import { agentStats, timeBounds, visibleRows, walk } from "@/app/dev/run-trace/trace-layout";
import { FIXTURES, loadFixture, type FixtureId } from "@/lib/run-trace/adapters/fixtures/load";
import { detectFormat, detectFormats, parseTrace, UnsupportedTraceError } from "@/lib/run-trace/adapters/registry";
import { LIMITS } from "@/lib/run-trace/adapters/types";
import type { AgentNode } from "@/lib/run-trace/types";

const IDS = Object.keys(FIXTURES) as FixtureId[];
const STEP_KINDS = new Set(["prompt", "thinking", "text", "tool", "event"]);

function assertValidNode(node: AgentNode, seen: Set<string>) {
  expect(seen.has(node.id), `duplicate agent id ${node.id}`).toBe(false);
  seen.add(node.id);
  expect(node.role.length).toBeGreaterThan(0);
  expect(Number.isNaN(Date.parse(node.startedAt))).toBe(false);
  expect(Number.isNaN(Date.parse(node.endedAt))).toBe(false);
  expect(Date.parse(node.endedAt)).toBeGreaterThanOrEqual(Date.parse(node.startedAt));
  for (const step of node.steps) expect(STEP_KINDS.has(step.kind)).toBe(true);
  for (const child of node.children) assertValidNode(child, seen);
}

describe("every fixture", () => {
  it.each(IDS)("%s is detected as its own format", (id) => {
    expect(detectFormat(loadFixture(id))?.id).toBe(id);
  });

  it.each(IDS)("%s parses into a RunTrace the layout code accepts", (id) => {
    const { trace, adapter } = parseTrace(loadFixture(id));
    expect(adapter.id).toBe(id);
    expect(trace.format).toBe(id);
    assertValidNode(trace.root, new Set());

    const bounds = timeBounds(trace.root);
    expect(bounds.end).toBeGreaterThan(bounds.start);
    expect(bounds.start).toBeGreaterThan(Date.parse("2026-01-01"));
    const rows = visibleRows(trace.root, new Set());
    expect(rows.length).toBe([...walk(trace.root)].length);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) expect(agentStats(row.node).durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("parseTrace", () => {
  it("honours a manual override", () => {
    expect(parseTrace(loadFixture("lintcat"), "lintcat").adapter.id).toBe("lintcat");
  });

  it("names what is supported when nothing matches", () => {
    const files = [{ name: "notes.json", text: '{"hello":"world"}' }];
    expect(detectFormats(files)).toEqual([]);
    expect(() => parseTrace(files)).toThrow(UnsupportedTraceError);
    expect(() => parseTrace(files)).toThrow(/OpenTelemetry GenAI spans/);
  });

  it("rejects an unknown format id", () => {
    expect(() => parseTrace(loadFixture("lintcat"), "nope")).toThrow(/Unknown format "nope"/);
  });

  it("caps the number of files", () => {
    const files = Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ name: `${i}.json`, text: "{}" }));
    expect(() => parseTrace(files)).toThrow(/Too many files/);
  });

  it("does not crash on junk", () => {
    expect(() => parseTrace([{ name: "x.jsonl", text: "\u0000\u0001{[" }])).toThrow(UnsupportedTraceError);
  });
});
