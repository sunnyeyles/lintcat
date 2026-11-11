import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createFakeRuntime } from "#src/fake-runtime";
import { collectRun, type AgentEvent, type AgentSpec } from "#src/runtime";

const spec = (overrides: Partial<AgentSpec> = {}): AgentSpec => ({
  role: "implementer",
  promptVersion: "test",
  systemPrompt: "",
  prompt: "go",
  cwd: "/tmp",
  readOnly: false,
  maxTurns: 5,
  ...overrides,
});

describe("fake runtime contract", () => {
  it("emits auth and session first and exactly one result last", async () => {
    const runtime = createFakeRuntime([() => ({ text: "done", structured: { ok: 1 } })]);
    const events: AgentEvent[] = [];
    const result = await collectRun(runtime.run(spec()), (e) => void events.push(e));
    expect(events.map((e) => e.type)).toEqual(["auth", "session", "text", "result"]);
    expect(result.structured).toEqual({ ok: 1 });
  });

  it("routes host tool calls through the spec's handlers", async () => {
    const calls: unknown[] = [];
    const runtime = createFakeRuntime([
      async ({ callTool }) => ({ text: await callTool("echo", { value: "x" }) }),
    ]);
    const result = await collectRun(
      runtime.run(
        spec({
          tools: [
            {
              name: "echo",
              description: "echo",
              input: { value: z.string() },
              handler: async (args) => {
                calls.push(args);
                return { text: `got ${String(args.value)}` };
              },
            },
          ],
        }),
      ),
    );
    expect(calls).toEqual([{ value: "x" }]);
    expect(result.text).toBe("got x");
  });

  it("keeps the session id on resume", async () => {
    const runtime = createFakeRuntime([() => ({}), () => ({})]);
    const sessions: string[] = [];
    const record = (e: AgentEvent) => void (e.type === "session" && sessions.push(e.sessionId));
    await collectRun(runtime.run(spec()), record);
    await collectRun(runtime.run(spec({ resumeSessionId: sessions[0] })), record);
    expect(sessions[1]).toBe(sessions[0]);
  });
});
