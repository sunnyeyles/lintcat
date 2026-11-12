/** Pure text for the terminal: everything here takes data and returns lines. */
import type { FactoryCommand, FactoryEvent, FactoryRun, FactoryService, Spec } from "@pr-review/factory";

export type Route = Awaited<ReturnType<FactoryService["propose"]>>["route"];
type ProfileSummary = Awaited<ReturnType<FactoryService["summary"]>>[number];

export const TERMINAL_STATUSES: readonly FactoryRun["status"][] = ["delivered", "failed", "cancelled"];

const list = (heading: string, items: readonly string[]): string[] =>
  items.length === 0 ? [] : [`${heading}:`, ...items.map((item) => `  - ${item}`)];

export function renderSpec(spec: Spec, route: Route, runId: string): string {
  const routing = route.ok
    ? `Profile:   ${route.profile}${route.overridden ? " (overridden)" : ""}: ${route.reason}`
    : `Blocked:   ${route.blocker}`;
  return [
    `── ${spec.title} (${runId})`,
    `Objective: ${spec.objective}`,
    `Category:  ${spec.category}   Risk: ${spec.risk}${spec.touchesSecurityOrData ? " (touches security or data)" : ""}   ~${spec.estimatedFiles} files`,
    routing,
    ...list("Requirements", spec.requirements),
    "Acceptance criteria:",
    ...spec.acceptanceCriteria.map((ac) => `  ${ac.id} [${ac.verification}] ${ac.text}`),
    "Plan:",
    ...spec.plan.map((step, index) => `  ${index + 1}. ${step}`),
    ...list("Architecture decisions", spec.architectureDecisions),
    ...list("Assumptions", spec.assumptions),
    ...list("Non-goals", spec.nonGoals),
    ...list("Constraints", spec.constraints),
  ].join("\n");
}

function scalar(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return undefined;
}

export function formatData(data: Record<string, unknown>): string {
  return Object.entries(data)
    .map(([key, value]) => [key, scalar(value)] as const)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

export function formatEvent(event: Pick<FactoryEvent, "at" | "kind" | "stage" | "data">): string {
  const time = event.at.toISOString().slice(11, 19);
  const stage = (event.stage ?? "").padEnd(9);
  return `${time} ${stage} ${event.kind.padEnd(18)} ${formatData(event.data)}`.trimEnd();
}

export function renderFailedCommand(command: FactoryCommand, maxLines = 30): string {
  const lines = command.output.split("\n");
  const tail = lines.length > maxLines ? [`... ${lines.length - maxLines} earlier lines`, ...lines.slice(-maxLines)] : lines;
  const why = command.timedOut ? "timed out" : `exit ${command.exitCode}`;
  return [`✗ ${command.stage}/${command.name} (${why}, ${command.durationMs}ms): ${command.command}`, ...tail.map((line) => `  ${line}`)].join("\n");
}

export function renderStatus(run: FactoryRun): string {
  return [
    `${run.id}  ${run.title}`,
    `Status:  ${run.status}${run.cancelRequested && !TERMINAL_STATUSES.includes(run.status) ? " (cancel requested)" : ""}`,
    `Stage:   ${run.stage ?? "-"}`,
    `Profile: ${run.profile ?? "-"}`,
    `Branch:  ${run.branch ?? "-"}`,
    `Repo:    ${run.repoPath}`,
    ...(run.blocker ? [`Blocker: ${run.blocker}`] : []),
  ].join("\n");
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd()).join("\n");
}

export function renderRuns(runs: readonly FactoryRun[]): string {
  if (runs.length === 0) return "No runs yet.";
  return table([
    ["ID", "STATUS", "PROFILE", "STAGE", "CREATED", "TITLE"],
    ...runs.map((run) => [run.id, run.status, run.profile ?? "-", run.stage ?? "-", run.createdAt.toISOString().slice(0, 16).replace("T", " "), run.title]),
  ]);
}

export function renderSummary(summary: readonly ProfileSummary[]): string {
  if (summary.length === 0) return "";
  const minutes = (ms: number | null) => (ms === null ? "-" : `${(ms / 60_000).toFixed(1)}m`);
  return table([
    ["PROFILE", "RUNS", "DELIVERED", "FAILED", "CANCELLED", "MEDIAN"],
    ...summary.map((s) => [s.profile, String(s.runs), String(s.delivered), String(s.failed), String(s.cancelled), minutes(s.medianDurationMs)]),
  ]);
}

export function renderResult(run: FactoryRun, taskPath: string): string {
  const outcome = run.outcome;
  const usage = outcome?.usage ? formatData(outcome.usage) : "";
  return [
    `${run.id}  ${run.title}  [${run.status}]`,
    ...(outcome?.summary ? [outcome.summary] : []),
    ...(run.blocker ? [`Blocker: ${run.blocker}`] : []),
    `Branch:  ${outcome?.branch ?? run.branch ?? "-"}`,
    `PR:      ${outcome?.pullRequestUrl ?? "-"}`,
    ...(outcome?.checks?.length ? ["Checks:", ...outcome.checks.map((c) => `  ${c.passed ? "✓" : "✗"} ${c.name} (exit ${c.exitCode})`)] : []),
    ...(usage ? [`Usage:   ${usage}`] : []),
    `Task:    ${taskPath}`,
  ].join("\n");
}
