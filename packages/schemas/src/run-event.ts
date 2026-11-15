import { z } from "zod";

/** The lintcat run format: one JSON object per line, emitted by any agent factory. */
export const RUN_FORMAT_VERSION = 1;

const MAX_ID = 128;
const MAX_TEXT = 100_000;

const id = z.string().min(1).max(MAX_ID);
const text = z.string().max(MAX_TEXT);
const at = z.iso.datetime({ offset: true });

const base = { v: z.literal(RUN_FORMAT_VERSION).optional(), at };

const runStarted = z.object({
  ...base,
  type: z.literal("run_started"),
  run: id,
  title: text.optional(),
});

const agentStarted = z.object({
  ...base,
  type: z.literal("agent_started"),
  agent: id,
  parent: id.optional(),
  role: z.string().min(1).max(MAX_ID),
  description: text.optional(),
  model: z.string().max(MAX_ID).optional(),
  stage: z.string().max(MAX_ID).optional(),
  prompt: text.optional(),
});

const step = z.object({
  ...base,
  type: z.literal("step"),
  agent: id,
  kind: z.enum(["prompt", "thinking", "text"]),
  text,
});

const toolCall = z.object({
  ...base,
  type: z.literal("tool_call"),
  agent: id,
  id,
  name: z.string().min(1).max(MAX_ID),
  input: z.unknown().optional(),
  summary: text.optional(),
  output: text.optional(),
  error: z.boolean().optional(),
  files: z.object({ read: z.array(text).max(1000).optional(), edited: z.array(text).max(1000).optional() }).optional(),
});

const toolResult = z.object({
  ...base,
  type: z.literal("tool_result"),
  agent: id,
  id,
  output: text.optional(),
  error: z.boolean().optional(),
});

const event = z.object({
  ...base,
  type: z.literal("event"),
  agent: id,
  name: z.string().min(1).max(MAX_ID),
  category: z.enum(["command", "check", "handoff", "log", "other"]).optional(),
  status: z.enum(["ok", "error", "running"]).optional(),
  text: text.optional(),
  output: text.optional(),
  durationMs: z.number().nonnegative().optional(),
});

const usage = z.object({
  ...base,
  type: z.literal("usage"),
  agent: id,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});

const agentFinished = z.object({
  ...base,
  type: z.literal("agent_finished"),
  agent: id,
  status: z.enum(["done", "failed", "cancelled"]),
  error: text.optional(),
});

const runFinished = z.object({
  ...base,
  type: z.literal("run_finished"),
  status: z.string().max(MAX_ID).optional(),
  summary: text.optional(),
  blocker: text.optional(),
  url: z.url().max(2000).optional(),
});

export const runEventSchema = z.discriminatedUnion("type", [
  runStarted,
  agentStarted,
  step,
  toolCall,
  toolResult,
  event,
  usage,
  agentFinished,
  runFinished,
]);

export type RunEvent = z.infer<typeof runEventSchema>;
export type RunEventType = RunEvent["type"];

export const RUN_EVENT_TYPES: readonly RunEventType[] = runEventSchema.options.map(
  (option) => option.shape.type.value,
);

export function runEventJsonSchema(): Record<string, unknown> {
  return {
    $id: "lintcat-run-format.schema.json",
    title: "lintcat run format event",
    description: "One line of a lintcat run format NDJSON stream.",
    ...z.toJSONSchema(runEventSchema, { target: "draft-2020-12", io: "input" }),
  };
}
