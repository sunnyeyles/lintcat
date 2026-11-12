// The one shape every adapter produces and the page renders: a tree of agents.
// Every field past the core is optional so sparse formats still render.

export type ToolCall = {
  id: string;
  name: string;
  /** One-line summary of the input: a path, a command, a pattern. */
  summary: string;
  input: unknown;
  /** Truncated tool result text. */
  result?: string;
  isError?: boolean;
  timestamp: string;
  /** Set when this call spawned a subagent (Agent / Task tool). */
  childAgentId?: string;
};

type TraceEventCategory = "command" | "check" | "handoff" | "log" | "other";
type TraceEventStatus = "ok" | "error" | "running";

/** A non-LLM step: a shell command, a check, a handoff, a log line. */
export type TraceEvent = {
  name: string;
  category: TraceEventCategory;
  status?: TraceEventStatus;
  text?: string;
  /** Long output, shown on expand. */
  detail?: string;
  durationMs?: number;
  timestamp: string;
};

export type AgentStep =
  | { kind: "prompt"; text: string; timestamp: string }
  | { kind: "thinking"; text: string; timestamp: string }
  | { kind: "text"; text: string; timestamp: string }
  | { kind: "tool"; call: ToolCall }
  | { kind: "event"; event: TraceEvent };

export type AgentStatus = "running" | "done" | "failed" | "cancelled";

export type TraceCost = { usd?: number; inputTokens?: number; outputTokens?: number };

export type ContextSample = {
  timestamp: string;
  /** input + cache read + cache creation tokens of one model turn. */
  tokens: number;
  outputTokens: number;
};

export type AgentNode = {
  id: string;
  /** Subagent type, e.g. "marrow-implementer"; "main" for the root session. */
  role: string;
  description?: string;
  model?: string;
  startedAt: string;
  endedAt: string;
  steps: AgentStep[];
  filesRead: string[];
  filesEdited: string[];
  context: ContextSample[];
  children: AgentNode[];
  status?: AgentStatus;
  stage?: string;
  cost?: TraceCost;
  error?: string;
};

export type RunOutcomeSummary = { status?: string; summary?: string; blocker?: string; url?: string };

export type RunTrace = {
  sessionId: string;
  title?: string;
  root: AgentNode;
  outcome?: RunOutcomeSummary;
  /** The adapter id that produced this trace. */
  format?: string;
};
