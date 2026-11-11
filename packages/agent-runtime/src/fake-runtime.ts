/** A scripted AgentRuntime for tests: each turn is a function, so it can edit files and call tools. */
import type { AgentEvent, AgentSpec, AgentRuntime, AgentUsage } from "#src/runtime";

export interface FakeTurnContext {
  spec: AgentSpec;
  /** Calls one of the spec's host tools the way the real runtime would. */
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

export interface FakeTurn {
  text?: string;
  structured?: unknown;
  ok?: boolean;
}

const ZERO_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimatedCostUsd: null,
};

export interface FakeRuntime extends AgentRuntime {
  readonly specs: AgentSpec[];
}

/** Turns are consumed in order across every run; running out is a test bug and throws. */
export function createFakeRuntime(
  turns: ((context: FakeTurnContext) => Promise<FakeTurn> | FakeTurn)[],
): FakeRuntime {
  const specs: AgentSpec[] = [];
  let next = 0;
  return {
    name: "fake",
    specs,
    async *run(spec) {
      specs.push(spec);
      const turn = turns[next++];
      if (!turn) throw new Error(`fake runtime has no turn ${next} for ${spec.role}`);
      const sessionId = spec.resumeSessionId ?? `fake-session-${next}`;
      yield { type: "auth", mode: "subscription", credentialSource: "fake", subscription: null } satisfies AgentEvent;
      yield { type: "session", sessionId } satisfies AgentEvent;
      const pending: AgentEvent[] = [];
      const callTool = async (name: string, args: Record<string, unknown>) => {
        if (spec.signal?.aborted) throw new Error("aborted");
        const hostTool = spec.tools?.find((t) => t.name === name);
        if (!hostTool) throw new Error(`no tool ${name}`);
        pending.push({ type: "tool_call", name, input: args });
        const result = await hostTool.handler(args);
        pending.push({ type: "tool_result", isError: result.isError === true });
        return result.text;
      };
      const outcome = await turn({ spec, callTool });
      yield* pending;
      if (outcome.text) yield { type: "text", text: outcome.text };
      yield {
        type: "result",
        ok: outcome.ok ?? true,
        reason: outcome.ok === false ? "error_during_execution" : "success",
        text: outcome.text ?? "",
        structured: outcome.structured,
        turns: 1,
        durationMs: 0,
        usage: ZERO_USAGE,
      };
    },
  };
}
