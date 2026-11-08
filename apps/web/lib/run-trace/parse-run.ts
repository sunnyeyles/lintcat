import { asObject, asString, parseJson } from "@/lib/run-trace/json";
import { parseTranscript, type ParsedTranscript } from "@/lib/run-trace/parse-transcript";
import { SPAWN_TOOLS } from "@/lib/run-trace/tool-summary";
import type { AgentNode, RunTrace, ToolCall } from "@/lib/run-trace/types";

export type RunFile = { name: string; text: string };

type AgentMeta = { agentType?: string; description?: string; toolUseId?: string };

const AGENT_FILE = /^agent-(.+)\.jsonl$/;
const META_FILE = /^agent-(.+)\.meta\.json$/;
const PROMPT_PREFIX = 200;

function basename(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

function readMeta(text: string): AgentMeta {
  const meta = parseJson(text);
  return {
    agentType: asString(meta?.agentType),
    description: asString(meta?.description),
    toolUseId: asString(meta?.toolUseId),
  };
}

function spawnCalls(node: AgentNode): ToolCall[] {
  return node.steps.flatMap((step) =>
    step.kind === "tool" && SPAWN_TOOLS.has(step.call.name) ? [step.call] : [],
  );
}

function samePrompt(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  return left === right || left.slice(0, PROMPT_PREFIX) === right.slice(0, PROMPT_PREFIX);
}

function emptyRoot(id: string): AgentNode {
  return {
    id,
    role: "main",
    startedAt: "",
    endedAt: "",
    steps: [],
    filesRead: [],
    filesEdited: [],
    context: [],
    children: [],
  };
}

/** Links each Agent/Task call to its transcript: meta toolUseId, then the result's agentId, then prompt text. */
function linkSpawns(transcripts: ParsedTranscript[], agents: Map<string, ParsedTranscript>, metas: Map<string, AgentMeta>) {
  const byCall = new Map<string, string>();
  for (const [agentId, meta] of metas) {
    if (meta.toolUseId && agents.has(agentId)) byCall.set(meta.toolUseId, agentId);
  }
  for (const transcript of transcripts) {
    for (const [callId, agentId] of transcript.spawned) {
      if (!byCall.has(callId) && agents.has(agentId)) byCall.set(callId, agentId);
    }
  }

  const claimed = new Set(byCall.values());
  const calls = transcripts.flatMap((t) => spawnCalls(t.node));
  for (const call of calls) {
    const linked = byCall.get(call.id);
    if (linked) {
      call.childAgentId = linked;
      continue;
    }
    const prompt = asString(asObject(call.input)?.prompt);
    if (!prompt) continue;
    const match = [...agents.values()].find(
      (agent) =>
        !claimed.has(agent.node.id) &&
        agent.firstPrompt !== undefined &&
        samePrompt(agent.firstPrompt, prompt),
    );
    if (match) {
      call.childAgentId = match.node.id;
      claimed.add(match.node.id);
    }
  }

  for (const call of calls) {
    const child = call.childAgentId ? agents.get(call.childAgentId)?.node : undefined;
    if (!child) continue;
    const input = asObject(call.input);
    if (child.role === "subagent") child.role = asString(input?.subagent_type) ?? child.role;
    child.description ??= asString(input?.description);
  }
}

function buildTree(root: AgentNode, agents: Map<string, ParsedTranscript>) {
  const placed = new Set<string>([root.id]);
  const place = (parent: AgentNode) => {
    for (const call of spawnCalls(parent)) {
      const child = call.childAgentId ? agents.get(call.childAgentId)?.node : undefined;
      if (!child || placed.has(child.id)) continue;
      placed.add(child.id);
      parent.children.push(child);
      place(child);
    }
  };
  place(root);

  const orphans = [...agents.values()]
    .map((agent) => agent.node)
    .filter((node) => !placed.has(node.id))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const orphan of orphans) {
    if (placed.has(orphan.id)) continue;
    placed.add(orphan.id);
    root.children.push(orphan);
    place(orphan);
  }
}

type SessionFiles = {
  id: string;
  main?: RunFile;
  agents: { id: string; text: string }[];
  metas: Map<string, AgentMeta>;
};

function parseSession(session: SessionFiles): RunTrace {
  const main = session.main
    ? parseTranscript(session.main.text, { id: session.id, role: "main", skipSidechain: true })
    : undefined;
  const sessionId = main?.sessionId ?? session.id;
  const root = main?.node ?? emptyRoot(sessionId);
  root.id = sessionId;

  const agents = new Map<string, ParsedTranscript>();
  for (const file of session.agents) {
    const meta = session.metas.get(file.id);
    const parsed = parseTranscript(file.text, {
      id: file.id,
      role: meta?.agentType ?? "subagent",
      cwd: main?.cwd,
    });
    parsed.node.description = meta?.description;
    agents.set(file.id, parsed);
  }

  linkSpawns(main ? [main, ...agents.values()] : [...agents.values()], agents, session.metas);
  buildTree(root, agents);
  if (!main && root.children.length > 0) {
    root.startedAt = root.children.map((c) => c.startedAt).sort()[0] ?? "";
    root.endedAt = root.children.map((c) => c.endedAt).sort().at(-1) ?? "";
  }
  return { sessionId, title: main?.title, root };
}

function wrapSessions(sessions: RunTrace[]): RunTrace {
  const children = sessions
    .map((session) => ({ ...session.root, description: session.title ?? session.root.description }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return {
    sessionId: "run",
    root: {
      ...emptyRoot("run"),
      role: "run",
      startedAt: children[0]?.startedAt ?? "",
      endedAt: children.map((c) => c.endedAt).sort().at(-1) ?? "",
      children,
    },
  };
}

/**
 * Turns a run's transcripts into one agent tree. Accepts a Claude Code project
 * layout (`<sid>.jsonl`, `<sid>/subagents/agent-*`); several sessions get a synthetic "run" root.
 */
export function parseRun(files: RunFile[]): RunTrace {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const sessions = new Map<string, SessionFiles>();
  const mains = sorted.filter((file) => {
    const base = basename(file.name);
    return base.endsWith(".jsonl") && !AGENT_FILE.test(base);
  });
  for (const file of mains) {
    const id = basename(file.name).replace(/\.jsonl$/, "");
    if (!sessions.has(id)) sessions.set(id, { id, main: file, agents: [], metas: new Map() });
  }

  const ownerOf = (file: RunFile, text?: string): SessionFiles => {
    const segments = file.name.split(/[\\/]/);
    const byPath = segments.map((segment) => sessions.get(segment)).find((s) => s !== undefined);
    const bySessionId = text === undefined ? undefined : sessions.get(parseTranscriptSessionId(text) ?? "");
    const owner = byPath ?? bySessionId ?? [...sessions.values()][0];
    if (owner) return owner;
    const fallback: SessionFiles = { id: "main", agents: [], metas: new Map() };
    sessions.set(fallback.id, fallback);
    return fallback;
  };

  for (const file of sorted) {
    const base = basename(file.name);
    const meta = META_FILE.exec(base)?.[1];
    const agent = AGENT_FILE.exec(base)?.[1];
    if (meta) ownerOf(file).metas.set(meta, readMeta(file.text));
    else if (agent) ownerOf(file, file.text).agents.push({ id: agent, text: file.text });
  }

  const traces = [...sessions.values()].map(parseSession);
  if (traces.length === 0) return parseSession({ id: "main", agents: [], metas: new Map() });
  return traces.length === 1 && traces[0] ? traces[0] : wrapSessions(traces);
}

function parseTranscriptSessionId(text: string): string | undefined {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? undefined : text.indexOf("\n"));
  return asString(parseJson(firstLine)?.sessionId);
}
