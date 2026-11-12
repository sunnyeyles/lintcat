import { z } from "zod";

import { asObject } from "@/lib/run-trace/json";
import {
  addCost,
  baseName,
  clip,
  emptyNode,
  iso,
  jsonDocument,
  jsonLines,
  pushStep,
  settleTimes,
  stringify,
} from "@/lib/run-trace/adapters/build";
import { LIMITS, type RunFile, type TraceAdapter } from "@/lib/run-trace/adapters/types";
import type { AgentNode, AgentStatus, RunTrace, TraceCost } from "@/lib/run-trace/types";

export const FACTORY_RUN_FILE = "factory-run.json";

const Time = z.union([z.string().max(64), z.number()]);
const Short = z.string().max(256);

const FactoryEvent = z
  .object({
    at: Time,
    kind: Short,
    runId: Short.optional(),
    stage: Short.nullish(),
    agentId: Short.nullish(),
    data: z.record(z.string(), z.unknown()).catch({}).default({}),
  })
  .loose();

const FactoryCommand = z
  .object({
    stage: Short,
    name: Short,
    command: z.string().max(LIMITS.text),
    startedAt: Time,
    durationMs: z.number().nonnegative().default(0),
    exitCode: z.number(),
    timedOut: z.boolean().default(false),
    errorCategory: Short.nullish(),
    output: z.string().default(""),
  })
  .loose();

const FactoryRunRow = z
  .object({
    id: Short,
    title: z.string().max(LIMITS.text).optional(),
    status: Short.optional(),
    stage: Short.nullish(),
    profile: Short.nullish(),
    blocker: z.string().max(LIMITS.text).nullish(),
    outcome: z
      .object({ summary: z.string().optional(), pullRequestUrl: z.string().optional(), usage: z.record(z.string(), z.unknown()).optional() })
      .loose()
      .nullish(),
    createdAt: Time.optional(),
    finishedAt: Time.nullish(),
  })
  .loose();

/** The export the factory connector writes and `factory-run.json` drops carry. */
export const FactoryRunExport = z.object({
  run: FactoryRunRow,
  events: z.array(z.unknown()).max(LIMITS.records).default([]),
  commands: z.array(z.unknown()).max(LIMITS.records).default([]),
});
export type FactoryRunExport = z.input<typeof FactoryRunExport>;

type Event = z.infer<typeof FactoryEvent>;
type Command = z.infer<typeof FactoryCommand>;
type Row = z.infer<typeof FactoryRunRow>;

const keep = <T>(schema: z.ZodType<T>, values: unknown[]): T[] =>
  values.flatMap((value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });

function read(files: readonly RunFile[]): { row?: Row; events: Event[]; commands: Command[]; title?: string } {
  const events: Event[] = [];
  const commands: Command[] = [];
  let row: Row | undefined;
  let title: string | undefined;
  for (const file of files) {
    const name = baseName(file.name);
    if (name.endsWith(".json")) {
      const parsed = FactoryRunExport.safeParse(jsonDocument(file.text));
      if (!parsed.success) continue;
      row = parsed.data.run;
      events.push(...keep(FactoryEvent, parsed.data.events));
      commands.push(...keep(FactoryCommand, parsed.data.commands));
    } else if (name === "events.jsonl") {
      events.push(...keep(FactoryEvent, jsonLines(file.text)));
    } else if (name === "task.md") {
      title = /^#\s+(.+)$/m.exec(file.text)?.[1]?.trim();
    }
  }
  return { row, events: events.slice(0, LIMITS.records), commands: commands.slice(0, LIMITS.records), title };
}

const RUN_STATUS: Record<string, AgentStatus> = {
  delivered: "done",
  failed: "failed",
  cancelled: "cancelled",
  queued: "running",
  running: "running",
  verifying: "running",
};

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

function usageCost(usage: unknown): TraceCost | undefined {
  const u = asObject(usage);
  if (!u) return undefined;
  return { inputTokens: num(u.inputTokens), outputTokens: num(u.outputTokens), usd: num(u.estimatedCostUsd) ?? undefined };
}

function brief(data: Record<string, unknown>): string | undefined {
  const parts = Object.entries(data)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 6)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return parts.length > 0 ? clip(parts.join(" · ")) : undefined;
}

function parseFactory(files: readonly RunFile[]): RunTrace {
  const { row, events, commands, title } = read(files);
  const runId = row?.id ?? events.find((e) => e.runId)?.runId ?? "factory-run";
  const root = emptyNode(runId, "factory");
  root.description = row?.profile ?? undefined;
  root.startedAt = iso(row?.createdAt);
  root.endedAt = iso(row?.finishedAt);
  root.status = row?.status ? RUN_STATUS[row.status] : undefined;

  const stages = new Map<string, AgentNode>();
  const agents = new Map<string, AgentNode>();
  const stageNode = (stage: string): AgentNode => {
    let node = stages.get(stage);
    if (!node) {
      node = { ...emptyNode(`stage:${stage}`, stage), stage, status: "done" };
      stages.set(stage, node);
      root.children.push(node);
    }
    return node;
  };
  const agentNode = (stage: string, agentId: string): AgentNode => {
    const key = `${stage}/${agentId}`;
    let node = agents.get(key);
    if (!node && agents.size < LIMITS.agents) {
      node = { ...emptyNode(`agent:${key}`, agentId), stage, description: stage, status: "running" };
      agents.set(key, node);
      stageNode(stage).children.push(node);
    }
    return node ?? stageNode(stage);
  };

  for (const event of events) {
    const at = iso(event.at);
    const stage = event.stage ?? undefined;
    const owner = stage ? (event.agentId ? agentNode(stage, event.agentId) : stageNode(stage)) : root;
    if (event.kind === "agent_finished" && event.agentId && owner !== root) {
      const durationMs = num(event.data.durationMs);
      if (durationMs !== undefined && at) owner.startedAt = new Date(Date.parse(at) - durationMs).toISOString();
      owner.endedAt = at;
      owner.status = event.data.ok === false ? "failed" : "done";
      if (event.data.ok === false) owner.error = clip(typeof event.data.reason === "string" ? event.data.reason : undefined);
      const cost = usageCost(event.data.usage);
      if (cost) addCost(owner, cost);
      const usage = asObject(event.data.usage);
      const context = (num(usage?.inputTokens) ?? 0) + (num(usage?.cacheReadTokens) ?? 0) + (num(usage?.cacheWriteTokens) ?? 0);
      if (context > 0) owner.context.push({ timestamp: at, tokens: context, outputTokens: num(usage?.outputTokens) ?? 0 });
      continue;
    }
    if (event.kind === "agent_auth") continue;
    const results = Array.isArray(event.data.results) ? event.data.results.map(asObject) : [];
    const failedChecks = results.filter((r) => typeof r?.exitCode === "number" && r.exitCode !== 0).length;
    pushStep(owner, {
      kind: "event",
      event: {
        name: event.kind,
        category: event.kind.startsWith("checks") || event.kind === "baseline_recorded" ? "check" : "log",
        status: /fail|blocked|rejected/.test(event.kind) || failedChecks > 0 ? "error" : "ok",
        text: results.length > 0 ? `${results.length - failedChecks}/${results.length} passed` : brief(event.data),
        detail: stringify(event.data),
        timestamp: at,
      },
    });
  }

  for (const command of commands) {
    const owner = command.name === "agent" ? ([...agents.values()].find((a) => a.stage === command.stage) ?? stageNode(command.stage)) : stageNode(command.stage);
    pushStep(owner, {
      kind: "event",
      event: {
        name: command.name === "agent" ? "sandbox_exec" : command.name,
        category: command.name === "agent" ? "command" : "check",
        status: command.exitCode === 0 && !command.timedOut ? "ok" : "error",
        text: clip(`$ ${command.command}${command.timedOut ? " (timed out)" : ` → exit ${command.exitCode}`}`),
        detail: clip(command.output),
        durationMs: command.durationMs,
        timestamp: iso(command.startedAt),
      },
    });
  }

  const failedStage = row?.stage && (root.status === "failed" || root.status === "running") ? stages.get(row.stage) : undefined;
  if (failedStage) failedStage.status = root.status;
  for (const node of agents.values()) if (node.status === "running" && root.status !== "running") node.status = undefined;

  const total = usageCost(row?.outcome?.usage);
  if (total) root.cost = total;
  else for (const node of agents.values()) if (node.cost) addCost(root, node.cost);

  settleTimes(root);
  return {
    sessionId: runId,
    title: row?.title ?? title ?? runId,
    root,
    outcome: row
      ? { status: row.status, summary: clip(row.outcome?.summary), blocker: clip(row.blocker ?? undefined), url: row.outcome?.pullRequestUrl }
      : undefined,
  };
}

function looksLikeEventLog(text: string): boolean {
  return jsonLines(text, 10).some((line) => {
    const record = asObject(line);
    return typeof record?.kind === "string" && typeof record.runId === "string" && (typeof record.taskId === "string" || String(record.toolVersion).startsWith("factory@"));
  });
}

export const factoryAdapter: TraceAdapter = {
  id: "lintcat-factory",
  label: "lintcat factory",
  hint: `a ${FACTORY_RUN_FILE} export, or a .factory/runs/<id>/ folder with events.jsonl`,
  detect(files) {
    for (const file of files) {
      const name = baseName(file.name);
      if (name.endsWith(".json") && file.text.includes('"run"') && file.text.includes('"events"')) {
        if (FactoryRunExport.safeParse(jsonDocument(file.text)).success) return 0.95;
      }
      if (name === "events.jsonl" && looksLikeEventLog(file.text)) return 0.9;
    }
    return 0;
  },
  parse: parseFactory,
};
