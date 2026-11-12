import { describe, expect, it } from "vitest";

import { loadFixture } from "@/lib/run-trace/adapters/fixtures/load";
import { openAiAgentsAdapter } from "@/lib/run-trace/adapters/openai-agents";

describe("openAiAgentsAdapter", () => {
  it("detects a traces/spans export", () => {
    expect(openAiAgentsAdapter.detect(loadFixture("openai-agents"))).toBeGreaterThan(0.9);
    expect(openAiAgentsAdapter.detect(loadFixture("otel-genai"))).toBe(0);
  });

  it("puts agent spans under their trace with generations, functions, handoffs and guardrails as steps", () => {
    const trace = openAiAgentsAdapter.parse(loadFixture("openai-agents"));
    expect(trace).toMatchObject({ sessionId: "trace_9a1f0c2e7b4d4e2f8a6b", title: "Trip planner" });
    expect(trace.root).toMatchObject({ role: "workflow", description: "Trip planner" });
    const [planner, booker] = trace.root.children;
    expect(planner).toMatchObject({ role: "Planner", model: "gpt-4o", status: "done" });
    expect(booker?.role).toBe("Booker");
    const steps = planner!.steps.map((s) =>
      s.kind === "tool" ? `tool:${s.call.name}` : s.kind === "event" ? `${s.event.category}:${s.event.name}` : s.kind,
    );
    expect(steps).toEqual(["prompt", "text", "tool:search_flights", "check:budget_check", "handoff:handoff"]);
    expect(booker!.context.map((c) => c.tokens)).toEqual([1500, 1900]);
  });

  it("reads NDJSON spans without a trace record", () => {
    const line = JSON.stringify({
      object: "trace.span",
      id: "s",
      trace_id: "t",
      started_at: "2026-01-01T00:00:00Z",
      ended_at: null,
      span_data: { type: "agent", name: "Solo" },
    });
    const { root } = openAiAgentsAdapter.parse([{ name: "spans.ndjson", text: `${line}\n{broken` }]);
    expect(root).toMatchObject({ role: "Solo", status: "running" });
  });
});
