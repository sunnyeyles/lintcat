import { formatDuration, formatTokens, toMs } from "@/app/dev/run-trace/trace-layout";
import type { AgentNode, ContextSample } from "@/lib/run-trace/types";

export type BotStatus = "running" | "done" | "failed";

export type BotEvent = {
  kind: string;
  label: string;
  timestamp: string;
  ok?: boolean;
};

export type BotTool = {
  id: string;
  name: string;
  summary: string;
  timestamp: string;
  result?: string;
  isError: boolean;
  childId?: string;
};

export type BotThought = { text: string; timestamp: string };

export type BotView = {
  id: string;
  role: string;
  description?: string;
  model?: string;
  startedAt: string;
  endedAt: string;
  durationMs?: number;
  prompt?: string;
  tools: BotTool[];
  thoughts: BotThought[];
  said: BotThought[];
  filesRead: string[];
  filesEdited: string[];
  context: ContextSample[];
  peakContext?: number;
  activeTool?: string;
  children: BotView[];
  status?: BotStatus;
  stage?: string;
  costUsd?: number;
  events?: BotEvent[];
};

// The adapters will add these to AgentNode; read them whenever a source already sets them.
type Extras = Partial<Pick<BotView, "status" | "stage" | "costUsd" | "events">>;

export function toBotView(node: AgentNode): BotView {
  const extras = node as AgentNode & Extras;
  const tools: BotTool[] = [];
  const thoughts: BotThought[] = [];
  const said: BotThought[] = [];
  let prompt: string | undefined;
  for (const step of node.steps ?? []) {
    if (step.kind === "tool") {
      const { call } = step;
      tools.push({
        id: call.id,
        name: call.name,
        summary: call.summary,
        timestamp: call.timestamp,
        result: call.result,
        isError: call.isError === true,
        childId: call.childAgentId,
      });
    } else if (step.kind === "prompt") prompt ??= nonEmpty(step.text);
    else if (step.kind === "thinking" && nonEmpty(step.text))
      thoughts.push({ text: step.text, timestamp: step.timestamp });
    else if (step.kind === "text" && nonEmpty(step.text)) said.push({ text: step.text, timestamp: step.timestamp });
  }

  const start = toMs(node.startedAt);
  const end = toMs(node.endedAt);
  const context = node.context ?? [];
  const pending = tools.findLast((tool) => tool.result === undefined && !tool.childId);
  const events = extras.events?.length ? extras.events : undefined;

  return {
    id: node.id,
    role: node.role,
    description: nonEmpty(node.description),
    model: node.model,
    startedAt: node.startedAt,
    endedAt: node.endedAt,
    durationMs: start && end >= start ? end - start : undefined,
    prompt: prompt ?? nonEmpty(node.description),
    tools,
    thoughts,
    said,
    filesRead: node.filesRead ?? [],
    filesEdited: node.filesEdited ?? [],
    context,
    peakContext: context.length > 0 ? Math.max(...context.map((sample) => sample.tokens)) : undefined,
    activeTool: pending?.name,
    children: (node.children ?? []).map(toBotView),
    status: extras.status ?? deriveStatus(node, Boolean(pending), events),
    stage: nonEmpty(extras.stage),
    costUsd: extras.costUsd,
    events,
  };
}

function deriveStatus(node: AgentNode, pending: boolean, events: BotEvent[] | undefined): BotStatus | undefined {
  if (pending) return "running";
  const last = (node.steps ?? []).filter((step) => step.kind !== "thinking").at(-1);
  if (last?.kind === "tool" && last.call.isError) return "failed";
  if (events?.at(-1)?.ok === false) return "failed";
  return toMs(node.endedAt) ? "done" : undefined;
}

function nonEmpty(text: string | undefined): string | undefined {
  return text && text.trim() !== "" ? text : undefined;
}

/** Only the stats a source actually gave; never a "0 tools" filler. */
export function botStats(bot: BotView): string[] {
  const stats: string[] = [];
  if (bot.durationMs) stats.push(formatDuration(bot.durationMs));
  if (bot.tools.length > 0) stats.push(`${bot.tools.length} ${bot.tools.length === 1 ? "tool" : "tools"}`);
  if (bot.peakContext) stats.push(`peak ${formatTokens(bot.peakContext)}`);
  if (bot.costUsd !== undefined) stats.push(formatCost(bot.costUsd));
  return stats;
}

export function formatCost(usd: number): string {
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

export function botLabel(bot: BotView, name: string): string {
  const head = bot.description ? `${name}: ${bot.description}` : name;
  const status = bot.status && bot.status !== "done" ? [bot.status] : [];
  return [head, ...botStats(bot), ...status].join(", ");
}

export function* walkBots(bot: BotView): Generator<BotView> {
  yield bot;
  for (const child of bot.children) yield* walkBots(child);
}
