import { createHash, randomBytes } from "node:crypto";
import { appendFile, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { TaskContract } from "#src/contract";

type ProgressStatus = "done" | "running" | "failed" | "skipped";

export type TaskView = {
  runId: string;
  status: string;
  stage: string | null;
  profile: string | null;
  contract: TaskContract;
  progress: { stage: string; status: ProgressStatus; note?: string }[];
  verification: { name: string; command: string; exitCode: number; passed: boolean; durationMs: number }[];
  deviations: string[];
  blockers: string[];
  outcome: { summary: string; branch?: string; pullRequestUrl?: string } | null;
  usage?: { estimatedCostUsd: number | null; inputTokens: number; outputTokens: number; note: string };
  /** Profile-specific evidence such as reproduction, baseline and review. */
  sections?: { heading: string; lines: string[] }[];
};

export function runDir(repo: string, runId: string): string {
  return join(repo, ".factory", "runs", runId);
}

const PROGRESS_MARK: Record<ProgressStatus, string> = { done: "x", running: " ", failed: " ", skipped: "-" };

function bullets(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function cell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function metadata(view: TaskView): string[] {
  const { contract, outcome, usage } = view;
  const lines = [
    `- **Run ID:** \`${view.runId}\``,
    `- **Profile:** ${view.profile ?? contract.profile}`,
    `- **Base SHA:** \`${contract.baseSha.slice(0, 7)}\`${contract.baseBranch ? ` (${contract.baseBranch})` : ""}`,
    `- **Status:** ${view.status}`,
  ];
  if (view.stage) lines.push(`- **Stage:** ${view.stage}`);
  if (outcome?.branch) lines.push(`- **Branch:** \`${outcome.branch}\``);
  if (outcome?.pullRequestUrl) lines.push(`- **Pull request:** ${outcome.pullRequestUrl}`);
  if (usage) {
    const cost = usage.estimatedCostUsd === null ? "unknown cost" : `~$${usage.estimatedCostUsd.toFixed(2)}`;
    const tokens = `${usage.inputTokens} in / ${usage.outputTokens} out tokens`;
    lines.push(`- **Usage:** ${cost}, ${tokens}${usage.note ? ` (${usage.note})` : ""}`);
  }
  return lines;
}

export function renderTaskMarkdown(view: TaskView): string {
  const { spec, implementationDecisions } = view.contract;
  const delivered = view.status === "delivered";
  const sections: string[][] = [[`# ${spec.title}`, "", ...metadata(view)]];
  const section = (heading: string, body: string[]) => {
    if (body.length > 0) sections.push([`## ${heading}`, "", ...body]);
  };

  section("Objective", [spec.objective]);
  section("Requirements", bullets(spec.requirements));
  section(
    "Acceptance criteria",
    spec.acceptanceCriteria.map((ac) => `- [${delivered ? "x" : " "}] ${ac.id} — ${ac.text} (${ac.verification})`),
  );
  section("Constraints", bullets(spec.constraints));
  section("Non-goals", bullets(spec.nonGoals));
  section("Repository findings", bullets(spec.repositoryFindings));
  section("Architecture & reuse decisions", [
    ...bullets(spec.architectureDecisions),
    ...implementationDecisions.map((d) => `- ${d.decision} _(${d.stage}, ${d.at})_`),
  ]);
  section("Implementation checklist", spec.plan.map((step, i) => `${i + 1}. ${step}`));
  section(
    "Progress",
    view.progress.map(
      (p) => `- [${PROGRESS_MARK[p.status]}] ${p.stage} — ${p.status}${p.note ? `: ${p.note}` : ""}`,
    ),
  );
  section("Assumptions & deviations", [
    ...bullets(spec.assumptions),
    ...view.deviations.map((d) => `- **Deviation:** ${d}`),
  ]);
  if (view.verification.length > 0) {
    section("Verification evidence", [
      "| Check | Command | Exit | Result | Duration |",
      "| --- | --- | --- | --- | --- |",
      ...view.verification.map(
        (v) =>
          `| ${cell(v.name)} | \`${cell(v.command)}\` | ${v.exitCode} | ${v.passed ? "pass" : "FAIL"} | ${formatDuration(v.durationMs)} |`,
      ),
    ]);
  }
  for (const extra of view.sections ?? []) section(extra.heading, extra.lines);
  section("Blockers", bullets(view.blockers));
  if (view.outcome) {
    const { summary, branch, pullRequestUrl } = view.outcome;
    section("Outcome", [
      summary,
      ...(branch || pullRequestUrl ? [""] : []),
      ...(branch ? [`- Branch: \`${branch}\``] : []),
      ...(pullRequestUrl ? [`- Pull request: ${pullRequestUrl}`] : []),
    ]);
  }
  return `${sections.map((lines) => lines.join("\n")).join("\n\n")}\n`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** A hand-edited task.md is copied to `task.user-edit.md` before being overwritten. */
export async function writeRunFiles(
  repo: string,
  runId: string,
  files: { view: TaskView; state: Record<string, unknown> },
): Promise<{ conflict: boolean }> {
  const dir = runDir(repo, runId);
  await mkdir(join(dir, "artifacts"), { recursive: true });
  const taskPath = join(dir, "task.md");
  const statePath = join(dir, "state.json");

  const existing = await readOrNull(taskPath);
  const previousState = await readOrNull(statePath);
  const storedHash = previousState ? (JSON.parse(previousState) as { taskMdHash?: unknown }).taskMdHash : undefined;
  const conflict = existing !== null && sha256(existing) !== storedHash;
  if (conflict) await copyFile(taskPath, join(dir, "task.user-edit.md"));

  const markdown = renderTaskMarkdown(files.view);
  await atomicWrite(taskPath, markdown);
  await atomicWrite(statePath, `${JSON.stringify({ ...files.state, taskMdHash: sha256(markdown) }, null, 2)}\n`);
  return { conflict };
}

export async function appendEventLine(repo: string, runId: string, event: object): Promise<void> {
  const dir = runDir(repo, runId);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, "events.jsonl"), `${JSON.stringify(event)}\n`);
}

export async function writeArtifact(repo: string, runId: string, name: string, content: string): Promise<string> {
  if (!name || name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`invalid artifact name: ${JSON.stringify(name)}`);
  }
  const dir = join(runDir(repo, runId), "artifacts");
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await atomicWrite(path, content);
  return path;
}

export async function readTaskMarkdown(repo: string, runId: string): Promise<string | null> {
  return readOrNull(join(runDir(repo, runId), "task.md"));
}
