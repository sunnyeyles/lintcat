import { describe, expect, it } from "vitest";

import { loadFixture } from "@/lib/run-trace/adapters/fixtures/load";
import { otelAdapter } from "@/lib/run-trace/adapters/otel";

describe("otelAdapter", () => {
  it("detects an OTLP export with gen_ai attributes", () => {
    expect(otelAdapter.detect(loadFixture("otel-genai"))).toBeGreaterThan(0.9);
    expect(otelAdapter.detect([{ name: "x.json", text: '{"resourceSpans":[]}' }])).toBe(0.6);
    expect(otelAdapter.detect(loadFixture("openai-agents"))).toBe(0);
  });

  it("turns agent spans into a tree and other spans into steps", () => {
    const { root, title } = otelAdapter.parse(loadFixture("otel-genai"));
    expect(title).toBe("support-desk");
    expect(root).toMatchObject({ role: "triage", description: "Routes support tickets", model: "gpt-4.1", status: "done" });
    const billing = root.children[0]!;
    expect(billing).toMatchObject({ role: "billing", model: "gpt-4.1-mini" });

    const spawn = root.steps.find((s) => s.kind === "tool" && s.call.name === "billing_agent");
    expect(spawn?.kind === "tool" && spawn.call.childAgentId).toBe(billing.id);
    expect(root.steps[0]).toMatchObject({ kind: "prompt", text: "Customer says the invoice total is wrong" });

    const kinds = billing.steps.map((s) => (s.kind === "tool" ? `tool:${s.call.name}:${s.call.isError}` : s.kind));
    expect(kinds).toEqual(["prompt", "text", "tool:post_credit:true", "text"]);
    expect(billing.events).toEqual([
      { kind: "command", label: "recalc-job: python recalc.py --invoice INV-2041", timestamp: "2026-11-10T09:00:20.000Z", ok: true },
    ]);
    expect(billing.context.map((c) => c.tokens)).toEqual([2400, 3100]);
    expect(billing.costUsd).toBeUndefined();
  });

  it("keeps an unfinished span running and skips junk spans", () => {
    const agent = {
      traceId: "t",
      spanId: "s1",
      name: "agent",
      startTimeUnixNano: "1700000000000000000",
      attributes: [{ key: "gen_ai.agent.name", value: { stringValue: "a" } }],
    };
    const text = JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [agent, { nope: true }] }] }] });
    const { root } = otelAdapter.parse([{ name: "t.json", text }]);
    expect(root).toMatchObject({ role: "a", status: "running" });
  });
});
