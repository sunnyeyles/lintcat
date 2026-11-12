import { RUN_EVENT_TYPES, runEventSchema, type RunEvent } from "@pr-review/schemas";

import { asObject } from "@/lib/run-trace/json";
import {
  addCost,
  clip,
  emptyNode,
  eventLabel,
  jsonLines,
  pushEvent,
  pushStep,
  rootOf,
  settleTimes,
} from "@/lib/run-trace/adapters/build";
import { LIMITS, type RunFile, type TraceAdapter } from "@/lib/run-trace/adapters/types";
import type { AgentNode, RunTrace, ToolCall } from "@/lib/run-trace/types";

const TYPES = new Set<string>(RUN_EVENT_TYPES);

function events(files: readonly RunFile[]): RunEvent[] {
  const out: RunEvent[] = [];
  for (const file of files) {
    for (const line of jsonLines(file.text, LIMITS.records - out.length)) {
      const parsed = runEventSchema.safeParse(line);
      if (parsed.success) out.push(parsed.data);
    }
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function summaryOf(input: unknown): string {
  const object = asObject(input);
  const first = object ? Object.values(object).find((value) => typeof value === "string") : input;
  return typeof first === "string" ? first.split("\n")[0]!.slice(0, 160) : "";
}

function parseLintcat(files: readonly RunFile[]): RunTrace {
  const agents = new Map<string, AgentNode>();
  const parents = new Map<string, string>();
  const calls = new Map<string, ToolCall>();
  const trace: RunTrace = { sessionId: "run", root: emptyNode("run", "run") };

  const agentFor = (id: string, at: string): AgentNode => {
    let node = agents.get(id);
    if (!node && agents.size < LIMITS.agents) {
      node = { ...emptyNode(id, "agent"), startedAt: at, status: "running" };
      agents.set(id, node);
    }
    return node ?? trace.root;
  };

  for (const event of events(files)) {
    switch (event.type) {
      case "run_started":
        trace.sessionId = event.run;
        trace.title = event.title;
        trace.root.startedAt = event.at;
        break;
      case "agent_started": {
        const node = agentFor(event.agent, event.at);
        Object.assign(node, { role: event.role, description: event.description, model: event.model, stage: event.stage, startedAt: event.at });
        if (event.parent) parents.set(event.agent, event.parent);
        if (event.prompt) pushStep(node, { kind: "prompt", text: clip(event.prompt)!, timestamp: event.at });
        break;
      }
      case "step":
        pushStep(agentFor(event.agent, event.at), { kind: event.kind, text: clip(event.text)!, timestamp: event.at });
        break;
      case "tool_call": {
        const node = agentFor(event.agent, event.at);
        const call: ToolCall = {
          id: event.id,
          name: event.name,
          summary: event.summary ?? summaryOf(event.input),
          input: event.input ?? {},
          result: clip(event.output),
          isError: event.error,
          timestamp: event.at,
        };
        calls.set(`${event.agent}\u0000${event.id}`, call);
        pushStep(node, { kind: "tool", call });
        node.filesRead.push(...(event.files?.read ?? []));
        node.filesEdited.push(...(event.files?.edited ?? []));
        break;
      }
      case "tool_result": {
        const call = calls.get(`${event.agent}\u0000${event.id}`);
        if (call) {
          call.result = clip(event.output) ?? "";
          call.isError = event.error ?? call.isError;
        }
        break;
      }
      case "event":
        pushEvent(agentFor(event.agent, event.at), {
          kind: event.category ?? "other",
          label: eventLabel(event.name, event.text),
          timestamp: event.at,
          ok: event.status === undefined || event.status === "running" ? undefined : event.status === "ok",
        });
        break;
      case "usage": {
        const node = agentFor(event.agent, event.at);
        node.context.push({ timestamp: event.at, tokens: event.inputTokens, outputTokens: event.outputTokens ?? 0 });
        addCost(node, event.costUsd);
        break;
      }
      case "agent_finished": {
        const node = agentFor(event.agent, event.at);
        node.status = event.status === "done" ? "done" : "failed";
        node.endedAt = event.at;
        if (event.status === "cancelled" || event.error) {
          pushEvent(node, { kind: event.status === "cancelled" ? "cancelled" : "error", label: event.error ?? "cancelled", timestamp: event.at, ok: false });
        }
        break;
      }
      case "run_finished":
        trace.outcome = { status: event.status, summary: clip(event.summary), blocker: clip(event.blocker), url: event.url };
        trace.root.endedAt = event.at;
        break;
    }
  }

  const tops: AgentNode[] = [];
  for (const [id, node] of agents) {
    const parent = parents.get(id);
    const owner = parent && parent !== id ? agents.get(parent) : undefined;
    if (owner && !isAncestor(node, owner, parents, agents)) owner.children.push(node);
    else tops.push(node);
  }
  for (const node of agents.values()) {
    for (const child of node.children) linkSpawn(node, child);
  }

  const hasRunNode = trace.title !== undefined || trace.root.startedAt !== "" || trace.outcome !== undefined;
  trace.root = hasRunNode ? { ...trace.root, id: trace.sessionId, children: tops } : rootOf(tops);
  if (trace.outcome?.status) trace.root.status = runStatus(trace.outcome.status);
  settleTimes(trace.root);
  return trace;
}

function runStatus(status: string): AgentNode["status"] {
  return /fail|error|block|cancel/i.test(status) ? "failed" : "done";
}

// Guards against a parent cycle (a → b → a), which would loop the tree.
function isAncestor(node: AgentNode, candidate: AgentNode, parents: Map<string, string>, agents: Map<string, AgentNode>): boolean {
  const seen = new Set<string>();
  for (let id: string | undefined = candidate.id; id && !seen.has(id); id = parents.get(id)) {
    if (id === node.id) return true;
    seen.add(id);
    if (!agents.has(id)) break;
  }
  return false;
}

// A tool call whose id names a child agent links to it, as Agent/Task calls do for Claude Code.
function linkSpawn(parent: AgentNode, child: AgentNode): void {
  for (const step of parent.steps) {
    if (step.kind === "tool" && (step.call.id === child.id || step.call.childAgentId === child.id)) {
      step.call.childAgentId = child.id;
    }
  }
}

export const lintcatAdapter: TraceAdapter = {
  id: "lintcat",
  label: "lintcat run format",
  hint: "an .ndjson stream of lintcat run format events",
  detect(files) {
    let seen = 0;
    let valid = 0;
    for (const file of files) {
      for (const line of jsonLines(file.text, 20)) {
        const type = asObject(line)?.type;
        if (typeof type !== "string") continue;
        seen += 1;
        if (TYPES.has(type) && runEventSchema.safeParse(line).success) valid += 1;
      }
    }
    if (valid === 0) return 0;
    return valid / seen >= 0.5 ? 0.95 : 0.5;
  },
  parse: parseLintcat,
};
