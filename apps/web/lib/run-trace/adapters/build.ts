import { truncate } from "@/lib/run-trace/json";
import { LIMITS } from "@/lib/run-trace/adapters/types";
import type { AgentNode, AgentStep, TraceEvent } from "@/lib/run-trace/types";

export function emptyNode(id: string, role: string): AgentNode {
  return { id, role, startedAt: "", endedAt: "", steps: [], filesRead: [], filesEdited: [], context: [], children: [] };
}

export function clip(text: string | undefined): string | undefined {
  return text === undefined ? undefined : truncate(text, LIMITS.text);
}

export function pushStep(node: AgentNode, step: AgentStep): void {
  if (node.steps.length < LIMITS.stepsPerAgent) node.steps.push(step);
}

export function pushEvent(node: AgentNode, event: TraceEvent): void {
  node.events ??= [];
  if (node.events.length < LIMITS.stepsPerAgent) node.events.push({ ...event, label: clip(event.label) ?? "" });
}

/** "name: detail", or just the name. */
export function eventLabel(name: string, detail: string | undefined): string {
  return detail ? `${name}: ${detail}` : name;
}

export function stringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return clip(value);
  try {
    return clip(JSON.stringify(value, null, 2));
  } catch {
    return undefined;
  }
}

function stepTime(step: AgentStep): string {
  return step.kind === "tool" ? step.call.timestamp : step.timestamp;
}

const validTime = (iso: string | undefined): iso is string => !!iso && !Number.isNaN(Date.parse(iso));

/** Fills missing start/end from steps and children, deepest first, and sorts steps by time. */
export function settleTimes(node: AgentNode): void {
  for (const child of node.children) settleTimes(child);
  node.steps.sort((a, b) => Date.parse(stepTime(a)) - Date.parse(stepTime(b)));
  node.events?.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const times = [
    ...node.steps.map(stepTime),
    ...(node.events ?? []).map((event) => event.timestamp),
    ...node.context.map((sample) => sample.timestamp),
    ...node.children.flatMap((child) => [child.startedAt, child.endedAt]),
  ].filter(validTime);
  const sorted = times.sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = sorted[0];
  const last = sorted.at(-1);
  // A parent spans its children, even when its own clock says it started later.
  if (!validTime(node.startedAt) || (first && Date.parse(first) < Date.parse(node.startedAt))) node.startedAt = first ?? "";
  if (!validTime(node.endedAt) || (last && Date.parse(last) > Date.parse(node.endedAt))) node.endedAt = last ?? node.startedAt;
}

export function addCost(target: AgentNode, usd: number | undefined): void {
  if (usd !== undefined) target.costUsd = (target.costUsd ?? 0) + usd;
}

export function isoFromNanos(value: unknown): string {
  const text = typeof value === "number" ? String(Math.trunc(value)) : typeof value === "string" ? value : "";
  if (!/^\d{1,22}$/.test(text)) return "";
  const ms = Number(BigInt(text) / 1_000_000n);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

export function iso(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Seconds or milliseconds since the epoch.
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value !== "string") return "";
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString();
}

export const baseName = (name: string) => name.split(/[\\/]/).pop() ?? name;

/** Non-empty lines, capped; each parsed independently so one broken line costs one record. */
export function jsonLines(text: string, limit: number = LIMITS.records): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    if (out.length >= limit) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  return out;
}

export function jsonDocument(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A whole-file JSON document, or else one value per line. */
export function jsonValues(text: string): unknown[] {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const whole = jsonDocument(text);
    if (whole !== undefined) return [whole];
  }
  return jsonLines(text);
}

/** Puts several roots under one synthetic run node, or returns the only one. */
export function rootOf(roots: AgentNode[], id = "run"): AgentNode {
  if (roots.length === 1 && roots[0]) return roots[0];
  const root = emptyNode(id, "run");
  root.children = roots;
  return root;
}
