/** The runtime-neutral contract the factory drives agents through. */
import type { z } from "zod";

export type AuthMode = "subscription" | "api-key";

export interface AgentToolResult {
  text: string;
  isError?: boolean;
}

/** A host-side tool the agent may call; the handler runs in the factory, not the agent. */
export interface AgentTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  input: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<AgentToolResult>;
}

export interface AgentSpec {
  role: string;
  promptVersion: string;
  systemPrompt: string;
  prompt: string;
  /** Every file tool is confined to this directory. */
  cwd: string;
  /** Read, Glob and Grep only; otherwise Edit and Write too. */
  readOnly: boolean;
  tools?: AgentTool[];
  maxTurns: number;
  /** JSON Schema the final answer must match; it arrives as `structured`. */
  outputSchema?: Record<string, unknown>;
  resumeSessionId?: string;
  model?: string;
  signal?: AbortSignal;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** The runtime's own estimate; notional under a subscription, never a bill. */
  estimatedCostUsd: number | null;
}

export type AgentEvent =
  | { type: "auth"; mode: AuthMode; credentialSource: string; subscription: string | null }
  | { type: "session"; sessionId: string }
  | { type: "tool_call"; name: string; input: unknown }
  | { type: "tool_result"; isError: boolean }
  | { type: "text"; text: string }
  | {
      type: "result";
      ok: boolean;
      reason: string;
      text: string;
      structured: unknown;
      turns: number;
      durationMs: number;
      usage: AgentUsage;
    };

export interface AgentRuntime {
  readonly name: string;
  /** Ends with exactly one `result` event unless it throws. */
  run(spec: AgentSpec): AsyncIterable<AgentEvent>;
}

export class AgentAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentAuthError";
  }
}

export type AgentResult = Extract<AgentEvent, { type: "result" }>;

/** Drains a run, passing every event on, and returns its result. */
export async function collectRun(
  events: AsyncIterable<AgentEvent>,
  onEvent: (event: AgentEvent) => void | Promise<void> = () => {},
): Promise<AgentResult> {
  let result: AgentResult | undefined;
  for await (const event of events) {
    await onEvent(event);
    if (event.type === "result") result = event;
  }
  if (!result) throw new Error("agent run ended without a result");
  return result;
}
