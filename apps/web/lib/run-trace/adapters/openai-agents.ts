import { z } from "zod";

import { asObject, asString } from "@/lib/run-trace/json";
import {
  clip,
  emptyNode,
  eventLabel,
  iso,
  jsonDocument,
  jsonValues,
  pushEvent,
  pushStep,
  rootOf,
  settleTimes,
  stringify,
} from "@/lib/run-trace/adapters/build";
import { LIMITS, type RunFile, type TraceAdapter } from "@/lib/run-trace/adapters/types";
import type { AgentNode, RunTrace } from "@/lib/run-trace/types";

const Id = z.string().min(1).max(128);

const Trace = z
  .object({ object: z.literal("trace"), id: Id, workflow_name: z.string().max(1000).optional(), group_id: z.string().max(256).nullish() })
  .loose();

const Span = z
  .object({
    object: z.literal("trace.span"),
    id: Id,
    trace_id: Id,
    parent_id: Id.nullish(),
    started_at: z.union([z.string(), z.number()]).nullish(),
    ended_at: z.union([z.string(), z.number()]).nullish(),
    span_data: z.object({ type: z.string().max(64) }).loose(),
    error: z.object({ message: z.string().max(10_000).optional() }).loose().nullish(),
  })
  .loose();

type Span = z.infer<typeof Span>;
type Trace = z.infer<typeof Trace>;

function* records(value: unknown): Generator<unknown> {
  if (Array.isArray(value)) {
    for (const item of value) yield* records(item);
    return;
  }
  const object = asObject(value);
  if (!object) return;
  if (object.object === "trace" || object.object === "trace.span") {
    yield object;
    return;
  }
  for (const key of ["data", "traces", "spans", "items"]) {
    if (Array.isArray(object[key])) yield* records(object[key]);
  }
}

function read(files: readonly RunFile[]): { traces: Trace[]; spans: Span[] } {
  const traces: Trace[] = [];
  const spans: Span[] = [];
  for (const file of files) {
    for (const value of jsonValues(file.text)) {
      for (const record of records(value)) {
        if (traces.length + spans.length >= LIMITS.records) return { traces, spans };
        const span = Span.safeParse(record);
        if (span.success) spans.push(span.data);
        else {
          const trace = Trace.safeParse(record);
          if (trace.success) traces.push(trace.data);
        }
      }
    }
  }
  return { traces, spans };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => asString(asObject(part)?.text) ?? "")
    .filter(Boolean)
    .join("\n");
}

function messageTexts(value: unknown, role?: string): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const message = asObject(item);
    if (!message || (role && message.role !== role)) return [];
    const text = contentText(message.content);
    return text ? [text] : [];
  });
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function parseOpenAiAgents(files: readonly RunFile[]): RunTrace {
  const { traces, spans } = read(files);
  const byId = new Map(spans.map((span) => [span.id, span]));
  const nodes = new Map<string, AgentNode>();
  const traceNodes = new Map<string, AgentNode>();

  for (const trace of traces) {
    const node = emptyNode(trace.id, "workflow");
    node.description = trace.workflow_name;
    traceNodes.set(trace.id, node);
  }
  for (const span of spans) {
    if (!traceNodes.has(span.trace_id)) traceNodes.set(span.trace_id, emptyNode(span.trace_id, "workflow"));
    if (span.span_data.type !== "agent" || nodes.size >= LIMITS.agents) continue;
    const node = emptyNode(span.id, asString(span.span_data.name) ?? "agent");
    node.startedAt = iso(span.started_at);
    node.endedAt = iso(span.ended_at);
    node.status = !span.ended_at ? "running" : span.error ? "failed" : "done";
    if (span.error) pushEvent(node, { kind: "error", label: span.error.message ?? "agent failed", timestamp: node.endedAt, ok: false });
    const tools = span.span_data.tools;
    if (Array.isArray(tools) && tools.length > 0) node.description = `tools: ${tools.slice(0, 8).join(", ")}`;
    nodes.set(span.id, node);
  }

  const ownerOf = (span: Span): AgentNode => {
    const seen = new Set<string>();
    for (let id = span.parent_id; id && !seen.has(id); id = byId.get(id)?.parent_id) {
      seen.add(id);
      const node = nodes.get(id);
      if (node) return node;
    }
    return traceNodes.get(span.trace_id)!;
  };

  for (const span of spans) {
    const own = nodes.get(span.id);
    if (own) ownerOf(span).children.push(own);
    else addStep(ownerOf(span), span, nodes, spans);
  }

  const roots = [...traceNodes.values()].map((node) => (node.children.length === 1 && node.steps.length === 0 ? withTitle(node) : node));
  const root = rootOf(roots);
  settleTimes(root);
  const workflow = traces[0]?.workflow_name;
  return { sessionId: traces.length === 1 ? traces[0]!.id : (traceNodes.keys().next().value ?? "run"), title: workflow, root };
}

// A trace with one top agent shows that agent as the root, labelled with the workflow.
function withTitle(node: AgentNode): AgentNode {
  const only = node.children[0]!;
  return { ...only, description: only.description ?? node.description };
}

function addStep(owner: AgentNode, span: Span, nodes: Map<string, AgentNode>, spans: Span[]): void {
  const data = span.span_data;
  const at = iso(span.started_at);
  const end = iso(span.ended_at) || at;

  if (data.type === "generation" || data.type === "response") {
    owner.model ??= asString(data.model);
    const prompt = messageTexts(data.input, "user")[0];
    if (prompt && !owner.steps.some((s) => s.kind === "prompt")) {
      pushStep(owner, { kind: "prompt", text: clip(prompt)!, timestamp: at });
    }
    for (const text of messageTexts(data.output)) pushStep(owner, { kind: "text", text: clip(text)!, timestamp: end });
    const usage = asObject(data.usage);
    const inputTokens = num(usage?.input_tokens) ?? num(usage?.prompt_tokens);
    const outputTokens = num(usage?.output_tokens) ?? num(usage?.completion_tokens);
    if (inputTokens !== undefined) owner.context.push({ timestamp: end, tokens: inputTokens, outputTokens: outputTokens ?? 0 });
    return;
  }

  if (data.type === "function" || data.type === "mcp_tools") {
    const raw = data.input;
    const input = typeof raw === "string" ? (jsonDocument(raw) ?? raw) : (raw ?? {});
    const child = spans.find((s) => s.parent_id === span.id && nodes.has(s.id));
    const object = asObject(input);
    const first = object ? Object.values(object).find((v) => typeof v === "string") : input;
    pushStep(owner, {
      kind: "tool",
      call: {
        id: span.id,
        name: asString(data.name) ?? data.type,
        summary: typeof first === "string" ? first.split("\n")[0]!.slice(0, 160) : "",
        input,
        result: span.ended_at ? (stringify(data.output) ?? "") : undefined,
        isError: !!span.error,
        timestamp: at,
        childAgentId: child?.id,
      },
    });
    return;
  }

  const ok = !span.ended_at ? undefined : !span.error;
  if (data.type === "handoff") {
    const route = `${asString(data.from_agent) ?? "?"} → ${asString(data.to_agent) ?? "?"}`;
    pushEvent(owner, { kind: "handoff", label: eventLabel("handoff", route), timestamp: at, ok });
    return;
  }
  if (data.type === "guardrail") {
    const triggered = data.triggered === true;
    const name = asString(data.name) ?? "guardrail";
    pushEvent(owner, { kind: "check", label: eventLabel(name, triggered ? "tripwire triggered" : "passed"), timestamp: at, ok: triggered ? false : ok });
    return;
  }
  pushEvent(owner, { kind: "other", label: eventLabel(asString(data.name) ?? data.type, span.error?.message), timestamp: at, ok });
}

export const openAiAgentsAdapter: TraceAdapter = {
  id: "openai-agents",
  label: "OpenAI Agents SDK",
  hint: "a traces/spans JSON export (objects with \"object\": \"trace.span\")",
  detect(files) {
    let score = 0;
    for (const file of files) {
      if (file.text.includes('"trace.span"') && file.text.includes("span_data")) return 0.95;
      if (/"object"\s*:\s*"trace"/.test(file.text) && file.text.includes("workflow_name")) score = 0.6;
    }
    return score;
  },
  parse: parseOpenAiAgents,
};
