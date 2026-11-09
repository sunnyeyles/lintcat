// The shape a factory run (e.g. a marrow build) takes once its Claude Code
// transcripts are parsed: one tree of agents, each with what it thought, what
// it did, and how full its context window got. Parser and page share this.

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

export type AgentStep =
  | { kind: "prompt"; text: string; timestamp: string }
  | { kind: "thinking"; text: string; timestamp: string }
  | { kind: "text"; text: string; timestamp: string }
  | { kind: "tool"; call: ToolCall };

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
};

export type RunTrace = {
  sessionId: string;
  title?: string;
  root: AgentNode;
};
