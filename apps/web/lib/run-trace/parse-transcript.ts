import {
  asNumber,
  asObject,
  asString,
  parseJsonl,
  truncate,
  type JsonObject,
} from "@/lib/run-trace/json";
import { relativeTo, SPAWN_TOOLS, summariseInput, touchedFile } from "@/lib/run-trace/tool-summary";
import type { AgentNode, AgentStep, ContextSample, ToolCall } from "@/lib/run-trace/types";

export const RESULT_MAX = 2000;

const NOISE_PREFIXES = ["<system-reminder>", "<local-command-caveat>", "<local-command-stdout>"];
const AGENT_ID_IN_TEXT = /agentId:\s*([\w-]+)/;

export type ParsedTranscript = {
  node: AgentNode;
  sessionId?: string;
  agentId?: string;
  cwd?: string;
  title?: string;
  firstPrompt?: string;
  /** Spawning tool_use id → the agent id its result reported. */
  spawned: Map<string, string>;
};

export type TranscriptOptions = {
  id: string;
  role: string;
  /** Paths are made relative to this; defaults to the transcript's own first cwd. */
  cwd?: string;
  /** The main transcript: sidechain lines there belong to subagents. */
  skipSidechain?: boolean;
};

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const block = asObject(part);
      if (block?.type === "text") return asString(block.text) ?? "";
      if (block?.type === "image") return "[image]";
      return "";
    })
    .filter((text) => text !== "")
    .join("\n");
}

function isNoise(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed === "" || NOISE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

export function parseTranscript(text: string, options: TranscriptOptions): ParsedTranscript {
  const records = parseJsonl(text);
  const ownCwd = records.map((r) => asString(r.cwd)).find((cwd) => cwd !== undefined);
  const cwd = options.cwd ?? ownCwd;

  const steps: AgentStep[] = [];
  const calls = new Map<string, ToolCall>();
  const context: ContextSample[] = [];
  const samples = new Map<string, ContextSample>();
  const emitted = new Set<string>();
  const filesRead: string[] = [];
  const filesEdited: string[] = [];
  const spawned = new Map<string, string>();
  const parsed: Omit<ParsedTranscript, "node" | "spawned"> = { cwd: ownCwd };
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  const addFile = (list: string[], path: string) => {
    const relative = relativeTo(cwd, path);
    if (!list.includes(relative)) list.push(relative);
  };

  const addPrompt = (body: string, timestamp: string) => {
    if (isNoise(body)) return;
    parsed.firstPrompt ??= body;
    steps.push({ kind: "prompt", text: body, timestamp });
  };

  const onAssistant = (record: JsonObject, timestamp: string) => {
    const message = asObject(record.message);
    if (!message) return;
    const messageModel = asString(message.model);
    if (messageModel && messageModel !== "<synthetic>") model ??= messageModel;
    const messageKey =
      asString(message.id) ?? asString(record.requestId) ?? asString(record.uuid) ?? timestamp;

    const usage = asObject(message.usage);
    if (usage) {
      const tokens =
        asNumber(usage.input_tokens) +
        asNumber(usage.cache_read_input_tokens) +
        asNumber(usage.cache_creation_input_tokens);
      const outputTokens = asNumber(usage.output_tokens);
      const seen = samples.get(messageKey);
      if (seen) {
        seen.tokens = Math.max(seen.tokens, tokens);
        seen.outputTokens = Math.max(seen.outputTokens, outputTokens);
      } else {
        const sample = { timestamp, tokens, outputTokens };
        samples.set(messageKey, sample);
        context.push(sample);
      }
    }

    const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
    if (!Array.isArray(content)) return;
    for (const part of content) {
      const block = asObject(part);
      if (!block) continue;
      if (block.type === "tool_use") {
        const id = asString(block.id);
        const name = asString(block.name) ?? "unknown";
        if (!id || calls.has(id)) continue;
        const call: ToolCall = { id, name, summary: summariseInput(name, block.input), input: block.input, timestamp };
        calls.set(id, call);
        steps.push({ kind: "tool", call });
        const touched = touchedFile(name, block.input);
        if (touched) addFile(touched.kind === "read" ? filesRead : filesEdited, touched.path);
        continue;
      }
      const isThinking = block.type === "thinking" || block.type === "redacted_thinking";
      if (!isThinking && block.type !== "text") continue;
      const body = (isThinking ? asString(block.thinking) : asString(block.text)) ?? "";
      if (!isThinking && body.trim() === "") continue;
      const dedupeKey = `${messageKey}\u0000${String(block.type)}\u0000${body}`;
      if (body !== "" && emitted.has(dedupeKey)) continue;
      emitted.add(dedupeKey);
      steps.push({ kind: isThinking ? "thinking" : "text", text: body, timestamp });
    }
  };

  const onUser = (record: JsonObject, timestamp: string) => {
    if (record.isMeta === true) return;
    const content = asObject(record.message)?.content;
    if (typeof content === "string") {
      addPrompt(content, timestamp);
      return;
    }
    if (!Array.isArray(content)) return;
    const reported = asString(asObject(record.toolUseResult)?.agentId);
    for (const part of content) {
      const block = asObject(part);
      if (block?.type === "text") {
        addPrompt(asString(block.text) ?? "", timestamp);
        continue;
      }
      if (block?.type !== "tool_result") continue;
      const call = calls.get(asString(block.tool_use_id) ?? "");
      if (!call) continue;
      const body = resultText(block.content);
      call.result = truncate(body, RESULT_MAX);
      if (block.is_error === true) call.isError = true;
      if (SPAWN_TOOLS.has(call.name)) {
        const agentId = reported ?? AGENT_ID_IN_TEXT.exec(body)?.[1];
        if (agentId) spawned.set(call.id, agentId);
      }
    }
  };

  for (const record of records) {
    parsed.sessionId ??= asString(record.sessionId);
    parsed.agentId ??= asString(record.agentId);
    if (record.type === "ai-title") parsed.title = asString(record.aiTitle) ?? parsed.title;
    if (record.type === "summary") parsed.title ??= asString(record.summary);
    if (options.skipSidechain && record.isSidechain === true) continue;

    const timestamp = asString(record.timestamp);
    if (timestamp === undefined) continue;
    if (startedAt === undefined || timestamp < startedAt) startedAt = timestamp;
    if (endedAt === undefined || timestamp > endedAt) endedAt = timestamp;

    if (record.type === "assistant") onAssistant(record, timestamp);
    else if (record.type === "user") onUser(record, timestamp);
  }

  return {
    ...parsed,
    spawned,
    node: {
      id: options.id,
      role: options.role,
      model,
      startedAt: startedAt ?? "",
      endedAt: endedAt ?? startedAt ?? "",
      steps,
      filesRead,
      filesEdited,
      context,
      children: [],
    },
  };
}
