import type { AgentNode, ContextSample } from "@/lib/run-trace/types";

export type TimeBounds = { start: number; end: number };

export type LaneRow = {
  node: AgentNode;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
};

export type AgentStats = {
  durationMs: number;
  toolCount: number;
  peakContext: number;
};

export const CONTEXT_LIMIT = 200_000;

const ROLE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const TICK_STEPS_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
  1_800_000, 3_600_000, 7_200_000,
];

export function toMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

export function* walk(node: AgentNode): Generator<AgentNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

export function findAgent(root: AgentNode, id: string): AgentNode | undefined {
  for (const node of walk(root)) if (node.id === id) return node;
  return undefined;
}

export function ancestorIds(root: AgentNode, id: string): string[] {
  const path: string[] = [];
  const visit = (node: AgentNode): boolean => {
    if (node.id === id) return true;
    path.push(node.id);
    if (node.children.some(visit)) return true;
    path.pop();
    return false;
  };
  return visit(root) ? path : [];
}

export function visibleRows(root: AgentNode, collapsed: ReadonlySet<string>): LaneRow[] {
  const rows: LaneRow[] = [];
  const visit = (node: AgentNode, depth: number) => {
    const isCollapsed = collapsed.has(node.id);
    rows.push({ node, depth, hasChildren: node.children.length > 0, collapsed: isCollapsed });
    if (!isCollapsed) for (const child of sortByStart(node.children)) visit(child, depth + 1);
  };
  visit(root, 0);
  return rows;
}

function sortByStart(nodes: AgentNode[]): AgentNode[] {
  return [...nodes].sort((a, b) => toMs(a.startedAt) - toMs(b.startedAt));
}

export function timeBounds(root: AgentNode): TimeBounds {
  let start = Infinity;
  let end = -Infinity;
  for (const node of walk(root)) {
    const s = toMs(node.startedAt);
    const e = toMs(node.endedAt);
    if (s) start = Math.min(start, s);
    if (e) end = Math.max(end, e);
  }
  if (!Number.isFinite(start)) return { start: 0, end: 1 };
  if (!Number.isFinite(end) || end <= start) end = start + 1;
  return { start, end };
}

/** Position of `ms` inside `bounds` as a 0–1 fraction, clamped. */
export function fraction(ms: number, bounds: TimeBounds): number {
  const span = bounds.end - bounds.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (ms - bounds.start) / span));
}

export function barSpan(node: AgentNode, bounds: TimeBounds): { left: number; width: number } {
  const left = fraction(toMs(node.startedAt), bounds);
  const right = fraction(toMs(node.endedAt), bounds);
  return { left, width: Math.max(0, right - left) };
}

/** Round-interval axis ticks, as offsets from the run start, at most about `target` of them. */
export function axisTicks(bounds: TimeBounds, target = 8): number[] {
  const span = bounds.end - bounds.start;
  if (span <= 0 || target < 1) return [0];
  const step = TICK_STEPS_MS.find((s) => span / s <= target) ?? Math.ceil(span / target / 3_600_000) * 3_600_000;
  const ticks: number[] = [];
  for (let t = 0; t <= span; t += step) ticks.push(t);
  return ticks;
}

export function toolTimes(node: AgentNode): { id: string; ms: number; label: string; error: boolean }[] {
  return node.steps.flatMap((step) =>
    step.kind === "tool"
      ? [
          {
            id: step.call.id,
            ms: toMs(step.call.timestamp),
            label: `${step.call.name} ${step.call.summary}`.trim(),
            error: step.call.isError === true,
          },
        ]
      : [],
  );
}

/** A tool call still waiting on its result: mid-call, if the run is live. */
export function isRunning(node: AgentNode): boolean {
  return node.steps.some((step) => step.kind === "tool" && step.call.result === undefined);
}

export function agentStats(node: AgentNode): AgentStats {
  return {
    durationMs: Math.max(0, toMs(node.endedAt) - toMs(node.startedAt)),
    toolCount: node.steps.filter((step) => step.kind === "tool").length,
    peakContext: peakOf(node.context),
  };
}

function peakOf(samples: ContextSample[]): number {
  return samples.reduce((peak, sample) => Math.max(peak, sample.tokens), 0);
}

export function contextSeries(node: Pick<AgentNode, "startedAt" | "context">): { seconds: number; tokens: number; output: number }[] {
  const start = toMs(node.startedAt);
  return node.context.map((sample) => ({
    seconds: Math.max(0, Math.round((toMs(sample.timestamp) - start) / 1000)),
    tokens: sample.tokens,
    output: sample.outputTokens,
  }));
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/** Same role, same colour, across the tree and the lanes. */
export function roleColor(role: string): string {
  if (role === "main" || role === "run") return ROLE_COLORS[0];
  let hash = 0;
  for (const char of role.replace(/^[a-z]+-/, "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ROLE_COLORS[1 + (hash % (ROLE_COLORS.length - 1))];
}
