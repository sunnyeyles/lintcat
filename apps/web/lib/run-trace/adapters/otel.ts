import { z } from "zod";

import { asObject, asString } from "@/lib/run-trace/json";
import {
  addCost,
  clip,
  emptyNode,
  eventLabel,
  isoFromNanos,
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

const AnyValue: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      stringValue: z.string().optional(),
      intValue: z.union([z.string(), z.number()]).optional(),
      doubleValue: z.number().optional(),
      boolValue: z.boolean().optional(),
      arrayValue: z.object({ values: z.array(AnyValue).max(1000).optional() }).optional(),
    })
    .loose(),
);

const KeyValue = z.object({ key: z.string().max(256), value: AnyValue.optional() });
const Nanos = z.union([z.string().max(24), z.number()]);

const Span = z
  .object({
    traceId: z.string().max(64).default(""),
    spanId: z.string().min(1).max(64),
    parentSpanId: z.string().max(64).optional(),
    name: z.string().max(1000).default("span"),
    startTimeUnixNano: Nanos.optional(),
    endTimeUnixNano: Nanos.optional(),
    attributes: z.array(KeyValue).max(1000).optional(),
    status: z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string().optional() }).loose().optional(),
  })
  .loose();
type Span = z.infer<typeof Span>;

type Attrs = Record<string, unknown>;
type Parsed = { span: Span; attrs: Attrs; service?: string };

function anyValue(value: unknown): unknown {
  const v = asObject(value);
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  const array = asObject(v.arrayValue)?.values;
  return Array.isArray(array) ? array.map(anyValue) : undefined;
}

function attributes(list: z.infer<typeof KeyValue>[] | undefined): Attrs {
  return Object.fromEntries((list ?? []).map((kv) => [kv.key, anyValue(kv.value)]));
}

function* resourceSpans(value: unknown): Generator<{ resource: unknown; spans: unknown[] }> {
  if (Array.isArray(value)) {
    for (const item of value) yield* resourceSpans(item);
    return;
  }
  const object = asObject(value);
  if (!Array.isArray(object?.resourceSpans)) return;
  for (const rs of object.resourceSpans) {
    const resource = asObject(rs)?.resource;
    const scopes = asObject(rs)?.scopeSpans ?? asObject(rs)?.instrumentationLibrarySpans;
    if (!Array.isArray(scopes)) continue;
    for (const scope of scopes) {
      const spans = asObject(scope)?.spans;
      if (Array.isArray(spans)) yield { resource, spans };
    }
  }
}

function readSpans(files: readonly RunFile[]): Parsed[] {
  const out: Parsed[] = [];
  for (const file of files) {
    for (const value of jsonValues(file.text)) {
      for (const { resource, spans } of resourceSpans(value)) {
        const service = asString(attributes(z.array(KeyValue).catch([]).parse(asObject(resource)?.attributes))["service.name"]);
        for (const raw of spans) {
          if (out.length >= LIMITS.records) return out;
          const parsed = Span.safeParse(raw);
          if (parsed.success) out.push({ span: parsed.data, attrs: attributes(parsed.data.attributes), service });
        }
      }
    }
  }
  return out;
}

const AGENT_OPS = new Set(["invoke_agent", "create_agent"]);
const LLM_OPS = new Set(["chat", "text_completion", "generate_content"]);

const op = (p: Parsed) => asString(p.attrs["gen_ai.operation.name"]);
const isAgent = (p: Parsed) => AGENT_OPS.has(op(p) ?? "") || (!op(p) && typeof p.attrs["gen_ai.agent.name"] === "string");
const failed = (span: Span) => span.status?.code === 2 || span.status?.code === "STATUS_CODE_ERROR";
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

type Message = { role: string; text: string; reasoning: string };

/** `gen_ai.*.messages` in the current conventions, or a plain string prompt from older ones. */
function messages(value: unknown): Message[] {
  const parsed = typeof value === "string" ? (jsonDocument(value) ?? value) : value;
  if (typeof parsed === "string") return [{ role: "user", text: parsed, reasoning: "" }];
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const message = asObject(item);
    if (!message) return [];
    const parts = Array.isArray(message.parts) ? message.parts.map(asObject) : [];
    const text = [asString(message.content), ...parts.map((p) => (p?.type === "text" ? asString(p.content) : undefined))]
      .filter((t): t is string => !!t)
      .join("\n");
    const reasoning = parts.map((p) => (p?.type === "reasoning" ? asString(p.content) : undefined)).filter(Boolean).join("\n");
    return [{ role: asString(message.role) ?? "user", text, reasoning }];
  });
}

function parseOtel(files: readonly RunFile[]): RunTrace {
  const spans = readSpans(files);
  const byId = new Map(spans.map((p) => [p.span.spanId, p]));
  const nodes = new Map<string, AgentNode>();
  const parentOf = (p: Parsed) => (p.span.parentSpanId ? byId.get(p.span.parentSpanId) : undefined);

  const makeNode = (p: Parsed): AgentNode => {
    const node = emptyNode(p.span.spanId, asString(p.attrs["gen_ai.agent.name"]) ?? p.span.name);
    node.description = asString(p.attrs["gen_ai.agent.description"]);
    node.model = asString(p.attrs["gen_ai.request.model"]);
    node.startedAt = isoFromNanos(p.span.startTimeUnixNano);
    node.endedAt = isoFromNanos(p.span.endTimeUnixNano);
    node.status = !p.span.endTimeUnixNano ? "running" : failed(p.span) ? "failed" : "done";
    if (failed(p.span)) {
      pushEvent(node, { kind: "error", label: p.span.status?.message || "span failed", timestamp: node.endedAt || node.startedAt, ok: false });
    }
    return node;
  };

  for (const p of spans) {
    if (nodes.size >= LIMITS.agents) break;
    if (isAgent(p) || !parentOf(p)) nodes.set(p.span.spanId, makeNode(p));
  }

  const ownerOf = (p: Parsed): AgentNode | undefined => {
    const seen = new Set<string>();
    for (let up = parentOf(p); up && !seen.has(up.span.spanId); up = parentOf(up)) {
      seen.add(up.span.spanId);
      const node = nodes.get(up.span.spanId);
      if (node) return node;
    }
    return undefined;
  };

  const roots: AgentNode[] = [];
  for (const p of spans) {
    const own = nodes.get(p.span.spanId);
    const owner = ownerOf(p);
    if (own) {
      if (owner) owner.children.push(own);
      else roots.push(own);
      continue;
    }
    if (owner) addStep(owner, p, nodes, spans);
  }

  const root = rootOf(roots);
  const first = spans.find((p) => nodes.get(p.span.spanId) === roots[0]);
  const traceIds = new Set(spans.map((p) => p.span.traceId));
  settleTimes(root);
  return {
    sessionId: traceIds.size === 1 ? ([...traceIds][0] ?? "run") || "run" : "run",
    title: first?.service ?? first?.span.name,
    root,
  };
}

function addStep(owner: AgentNode, p: Parsed, nodes: Map<string, AgentNode>, spans: Parsed[]): void {
  const at = isoFromNanos(p.span.startTimeUnixNano);
  const end = isoFromNanos(p.span.endTimeUnixNano) || at;
  const operation = op(p);

  if (operation && LLM_OPS.has(operation)) {
    owner.model ??= asString(p.attrs["gen_ai.response.model"]) ?? asString(p.attrs["gen_ai.request.model"]);
    const input = messages(p.attrs["gen_ai.input.messages"] ?? p.attrs["gen_ai.prompt"]);
    const prompt = input.find((m) => m.role === "user" && m.text);
    if (prompt && !owner.steps.some((s) => s.kind === "prompt")) {
      pushStep(owner, { kind: "prompt", text: clip(prompt.text)!, timestamp: at });
    }
    for (const out of messages(p.attrs["gen_ai.output.messages"] ?? p.attrs["gen_ai.completion"])) {
      if (out.reasoning) pushStep(owner, { kind: "thinking", text: clip(out.reasoning)!, timestamp: end });
      if (out.text) pushStep(owner, { kind: "text", text: clip(out.text)!, timestamp: end });
    }
    const inputTokens = num(p.attrs["gen_ai.usage.input_tokens"]) ?? num(p.attrs["gen_ai.usage.prompt_tokens"]);
    const outputTokens = num(p.attrs["gen_ai.usage.output_tokens"]) ?? num(p.attrs["gen_ai.usage.completion_tokens"]);
    if (inputTokens !== undefined) owner.context.push({ timestamp: end, tokens: inputTokens, outputTokens: outputTokens ?? 0 });
    addCost(owner, num(p.attrs["gen_ai.usage.cost"]));
    return;
  }

  if (operation === "execute_tool") {
    const child = spans.find((s) => s.span.parentSpanId === p.span.spanId && nodes.has(s.span.spanId));
    const input = p.attrs["gen_ai.tool.call.arguments"];
    const args = typeof input === "string" ? (jsonDocument(input) ?? input) : input;
    pushStep(owner, {
      kind: "tool",
      call: {
        id: asString(p.attrs["gen_ai.tool.call.id"]) ?? p.span.spanId,
        name: asString(p.attrs["gen_ai.tool.name"]) ?? p.span.name,
        summary: typeof args === "string" ? args.slice(0, 160) : summarise(args),
        input: args ?? {},
        result: p.span.endTimeUnixNano ? (stringify(p.attrs["gen_ai.tool.call.result"]) ?? "") : undefined,
        isError: failed(p.span),
        timestamp: at,
        childAgentId: child?.span.spanId,
      },
    });
    return;
  }

  const command = asString(p.attrs["process.command_line"]) ?? asString(p.attrs["process.command"]);
  pushEvent(owner, {
    kind: command ? "command" : "other",
    label: eventLabel(p.span.name, command ?? p.span.status?.message),
    timestamp: at,
    ok: !p.span.endTimeUnixNano ? undefined : !failed(p.span),
  });
}

function summarise(args: unknown): string {
  const object = asObject(args);
  const first = object ? Object.values(object).find((v) => typeof v === "string") : undefined;
  return typeof first === "string" ? first.split("\n")[0]!.slice(0, 160) : "";
}

export const otelAdapter: TraceAdapter = {
  id: "otel-genai",
  label: "OpenTelemetry GenAI spans",
  hint: "an OTLP JSON export (resourceSpans) using the gen_ai.* conventions",
  detect(files) {
    let otlp = false;
    for (const file of files) {
      if (!file.text.includes("resourceSpans")) continue;
      otlp = true;
      if (file.text.includes('"gen_ai.')) return 0.95;
    }
    return otlp ? 0.6 : 0;
  },
  parse: parseOtel,
};
