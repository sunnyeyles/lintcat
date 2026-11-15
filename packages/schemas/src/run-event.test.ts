import { describe, expect, it } from "vitest";

import { RUN_EVENT_TYPES, runEventJsonSchema, runEventSchema } from "#src/run-event";

const AT = "2026-11-12T10:00:00Z";

describe("runEventSchema", () => {
  it("accepts every event type", () => {
    const events = [
      { type: "run_started", at: AT, run: "r1", title: "Fix login" },
      { type: "agent_started", at: AT, agent: "a1", role: "planner" },
      { type: "step", at: AT, agent: "a1", kind: "text", text: "Plan ready" },
      { type: "tool_call", at: AT, agent: "a1", id: "t1", name: "read_file", input: { path: "a.ts" } },
      { type: "tool_result", at: AT, agent: "a1", id: "t1", output: "…" },
      { type: "event", at: AT, agent: "a1", name: "pnpm test", category: "check", status: "ok" },
      { type: "usage", at: AT, agent: "a1", inputTokens: 1200, outputTokens: 80 },
      { type: "agent_finished", at: AT, agent: "a1", status: "done" },
      { type: "run_finished", at: AT, status: "delivered" },
    ];
    expect(events.map((e) => runEventSchema.safeParse(e).success)).toEqual(events.map(() => true));
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(RUN_EVENT_TYPES));
  });

  it("rejects unknown types, bad timestamps and oversized ids", () => {
    expect(runEventSchema.safeParse({ type: "nope", at: AT }).success).toBe(false);
    expect(runEventSchema.safeParse({ type: "run_started", at: "yesterday", run: "r" }).success).toBe(false);
    expect(runEventSchema.safeParse({ type: "run_started", at: AT, run: "x".repeat(200) }).success).toBe(false);
  });
});

describe("lintcat-run-format.schema.json", () => {
  // Refresh with `pnpm vitest run packages/schemas -u`.
  it("matches the Zod schema", async () => {
    await expect(`${JSON.stringify(runEventJsonSchema(), null, 2)}\n`).toMatchFileSnapshot("../lintcat-run-format.schema.json");
  });
});
