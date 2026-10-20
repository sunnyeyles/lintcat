import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";

/** The front end a process traces for, stamped on every trace as its tag. */
export type TraceSource = "worker" | "cli" | "mcp" | "eval";

// The AI SDK names spans `<operation> <model>` and `step <n>`: a model swap would orphan every filter.
const MODEL_SUFFIXED = /^(chat|embeddings|rerank|invoke_agent) /;

export function stableSpanName(name: string, agentName: unknown): string {
  if (name.startsWith("invoke_agent ") && typeof agentName === "string") return agentName;
  if (/^step \d+$/.test(name)) return "step";
  const match = MODEL_SUFFIXED.exec(name);
  return match ? match[1]! : name;
}

export function namingProcessor(inner: SpanProcessor, source: TraceSource): SpanProcessor {
  return {
    onStart(...[span, parentContext]: Parameters<SpanProcessor["onStart"]>) {
      span.updateName(stableSpanName(span.name, span.attributes["gen_ai.agent.name"]));
      if (!span.parentSpanContext) span.setAttribute("langfuse.trace.tags", [source]);
      inner.onStart(span, parentContext);
    },
    onEnd: (span) => inner.onEnd(span),
    forceFlush: () => inner.forceFlush(),
    shutdown: () => inner.shutdown(),
  };
}
