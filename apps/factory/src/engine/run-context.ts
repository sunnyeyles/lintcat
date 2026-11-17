/** One run's mutable state and its lease, deadline and abort lifecycle; stages read and write it here. */
import path from "node:path";

import { collectRun, type AgentResult, type AgentUsage } from "#src/agent/runtime";
import { errorMessage } from "@pr-review/logging";
import { z } from "zod";

import type { CheckPlan } from "#src/engine/checks";
import { recordDecision } from "#src/engine/contract";
import { DEFAULT_DEPLOY_CONFIG, renderDeployImpact, type DeployImpact, type DeployImpactConfig } from "#src/engine/deploy-impact";
import type { EngineDeps } from "#src/engine/engine";
import { headSha, slugify } from "#src/engine/git";
import { PROFILES, workflowVersion, type Profile, type Stage } from "#src/engine/profiles";
import { loadPrompt } from "#src/engine/prompts";
import { renderReview, type ValidatedReview } from "#src/engine/review";
import { writeArtifact, writeRunFiles, type TaskView } from "#src/engine/run-files";
import type { ExecResult, Sandbox } from "#src/engine/sandbox/sandbox";
import { renewLease, saveProgress, type Checkpoint, type FactoryRun } from "#src/engine/store/index";
import { createRecorder, type Recorder } from "#src/engine/telemetry";

export class RunStopped extends Error {
  constructor(
    readonly status: "failed" | "cancelled",
    readonly blocker: string,
  ) {
    super(blocker);
  }
}

interface CheckOutcome {
  name: string;
  command: string;
  exitCode: number;
  passed: boolean;
  durationMs: number;
  result: ExecResult;
}

type CheckRecord = { name: string; command: string; exitCode: number; passed: boolean; outputHash: string };

/** Everything a stage hands on, persisted in the checkpoint so recovery never redoes it. */
interface RunData {
  locate?: unknown;
  repairs?: number;
  summary?: string;
  baseline?: CheckRecord[];
  reproduce?: { status: "reproduced"; testFiles: string[]; failing: CheckRecord[] } | { status: "not_reproducible"; reason: string };
  review?: ValidatedReview;
  reviewRepair?: { sha: string };
  deployImpact?: DeployImpact;
  // `sha` is null when the repair changed nothing; `verified` once checks ran on it.
  deployImpactRepair?: { sha: string | null; verified: boolean };
  turnsUsed?: number;
}

export const record = (o: CheckOutcome): CheckRecord => ({ name: o.name, command: o.command, exitCode: o.exitCode, passed: o.passed, outputHash: o.result.outputHash });

export function errorCategory(result: ExecResult): string | null {
  if (result.timedOut) return "timeout";
  if (result.exitCode === 137) return "killed";
  if (result.exitCode === 127) return "command_not_found";
  return result.exitCode === 0 ? null : "nonzero_exit";
}

export class ActiveRun {
  readonly profile: Profile;
  readonly recorder: Recorder;
  readonly repo: string;
  readonly worktree: string;
  readonly branch: string;
  readonly progress: TaskView["progress"] = [];
  readonly verification: TaskView["verification"] = [];
  readonly deviations: string[] = [];
  readonly usage: AgentUsage[] = [];
  readonly data: RunData;
  contract: FactoryRun["contract"];
  checkpoint: Checkpoint | null;
  sessionId: string | undefined;
  status: FactoryRun["status"] = "running";
  currentStage: Stage | null = null;
  sandbox: Sandbox | undefined;
  setupPaths: string[] = [];
  deployConfig: DeployImpactConfig = DEFAULT_DEPLOY_CONFIG;

  private readonly abort = new AbortController();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly deadline: ReturnType<typeof setTimeout>;

  /** Starts the lease heartbeat and wall-clock deadline; `close()` must always follow. */
  constructor(
    readonly deps: EngineDeps,
    readonly claimed: FactoryRun,
  ) {
    const { database, logger } = deps;
    const leaseMs = deps.leaseMs ?? 60_000;
    const heartbeatMs = deps.heartbeatMs ?? 5_000;
    this.contract = claimed.contract;
    this.profile = PROFILES[this.contract.profile];
    this.recorder = createRecorder(
      database,
      { runId: claimed.id, taskId: this.contract.taskId, repoPath: claimed.repoPath, workflowVersion: workflowVersion(this.profile) },
      logger,
    );
    this.repo = claimed.repoPath;
    this.worktree = claimed.worktreePath ?? path.join(this.repo, ".factory", "worktrees", claimed.id);
    this.branch = claimed.branch ?? `factory/${slugify(this.contract.spec.title)}-${claimed.id.slice(-6)}`;
    this.checkpoint = claimed.checkpoint ?? null;
    this.data = { ...((this.checkpoint?.data ?? {}) as RunData) };
    this.sessionId = claimed.agentSessionId ?? undefined;

    this.heartbeat = setInterval(() => {
      renewLease(database, claimed.id, leaseMs)
        .then(({ alive, cancelRequested }) => {
          if (cancelRequested) this.stopWith(new RunStopped("cancelled", "cancelled by request"));
          else if (!alive) this.stopWith(new RunStopped("failed", "lease lost to another worker"));
        })
        .catch((error: unknown) => logger.error("lease renewal failed", { error: errorMessage(error) }));
    }, heartbeatMs);
    this.deadline = setTimeout(
      () => this.stopWith(new RunStopped("failed", `wall-clock budget of ${this.contract.budgets.wallClockMinutes} min exceeded`)),
      this.contract.budgets.wallClockMinutes * 60_000,
    );
  }

  private stopWith(reason: RunStopped) {
    if (!this.abort.signal.aborted) this.abort.abort(reason);
    void this.sandbox?.kill().catch(() => {});
  }

  throwIfStopped() {
    if (this.abort.signal.aborted) throw this.abort.signal.reason instanceof RunStopped ? this.abort.signal.reason : new RunStopped("failed", "aborted");
  }

  /** The stop behind a failure: the thrown one, else the abort that interrupted the stage. */
  stoppedBy(error: unknown): RunStopped | null {
    return error instanceof RunStopped ? error : this.abort.signal.reason instanceof RunStopped ? this.abort.signal.reason : null;
  }

  async close() {
    clearInterval(this.heartbeat);
    clearTimeout(this.deadline);
    await this.sandbox?.destroy().catch(() => {});
  }

  async sync(outcome: TaskView["outcome"] = null, blockers: string[] = []) {
    const view: TaskView = {
      runId: this.claimed.id,
      status: this.status,
      stage: this.currentStage,
      profile: this.profile.name,
      contract: this.contract,
      progress: this.progress,
      verification: this.verification,
      deviations: this.deviations,
      blockers,
      outcome,
      usage: summariseUsage(this.usage),
      sections: evidenceSections(this.data, this.verification),
    };
    await writeRunFiles(this.repo, this.claimed.id, {
      view,
      state: { runId: this.claimed.id, status: this.status, stage: this.currentStage, branch: this.branch, worktree: this.worktree, checkpoint: this.checkpoint, sessionId: this.sessionId },
    });
  }

  async save(stage: Stage, nextStage: Stage, sha?: string) {
    const next: Checkpoint = { stage, sha: sha ?? (await headSha(this.worktree)), nextStage, data: { ...this.data } as Record<string, unknown> };
    this.checkpoint = next;
    await saveProgress(this.deps.database, this.claimed.id, { checkpoint: next, stage: nextStage, contract: this.contract, ...(this.sessionId ? { agentSessionId: this.sessionId } : {}) });
  }

  decide(stage: Stage, decision: string) {
    this.contract = recordDecision(this.contract, stage, decision, new Date());
  }

  mark(stage: string, state: TaskView["progress"][number]["status"], note?: string) {
    const existing = this.progress.find((p) => p.stage === stage);
    if (existing) Object.assign(existing, { status: state, ...(note ? { note } : {}) });
    else this.progress.push({ stage, status: state, ...(note ? { note } : {}) });
  }

  withoutSetup(files: string[]) {
    return files.filter((f) => !this.setupPaths.some((p) => f === p || (p.endsWith("/") && f.startsWith(p))));
  }

  async runAgent<S extends z.ZodType>(
    stage: Stage,
    prompt: string,
    options: { role: "implementer" | "reviewer"; resume: boolean; schema: S },
  ): Promise<{ result: AgentResult; output: z.infer<S> | null }> {
    const { role, resume, schema } = options;
    const { contract, data } = this;
    const instructions = loadPrompt(role);
    const implementer = role === "implementer";
    // Implement and every repair pass draw on one turn budget; the reviewer gets its own.
    const turnsLeft = implementer ? contract.budgets.maxAgentTurns - (data.turnsUsed ?? 0) : contract.budgets.maxAgentTurns;
    if (turnsLeft <= 0) throw new RunStopped("failed", `agent turn budget of ${contract.budgets.maxAgentTurns} spent`);
    const result = await collectRun(
      this.deps.runtime.run({
        role,
        promptVersion: instructions.version,
        systemPrompt: instructions.text,
        prompt,
        cwd: this.worktree,
        readOnly: !implementer,
        maxTurns: turnsLeft,
        outputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
        signal: this.abort.signal,
        tools: implementer
          ? [
              {
                name: "sandbox_exec",
                description:
                  "Run a shell command in the offline sandbox with the worktree at /workspace. Returns exit code and output.",
                input: { command: z.string().min(1), cwd: z.string().optional() },
                handler: async (args) => {
                  const result = await this.sandboxExec(stage, "agent", String(args.command), typeof args.cwd === "string" ? args.cwd : undefined);
                  return { text: `exit ${result.exitCode}${result.timedOut ? " (timed out)" : ""}\n${result.output}`, isError: result.exitCode !== 0 };
                },
              },
            ]
          : [],
        ...(implementer && resume && this.sessionId ? { resumeSessionId: this.sessionId } : {}),
      }),
      async (event) => {
        // The reviewer's session is disposable; only the implementer's is ever resumed.
        if (event.type === "session" && implementer) this.sessionId = event.sessionId;
        if (event.type === "auth") {
          await this.recorder.event({ kind: "agent_auth", stage, agentId: role, promptVersion: instructions.version, data: { ...event } });
        }
      },
    );
    this.usage.push(result.usage);
    if (implementer) data.turnsUsed = (data.turnsUsed ?? 0) + result.turns;
    const parsed = schema.safeParse(result.structured);
    const outputStatus = parsed.success ? (parsed.data as { status?: unknown; verdict?: unknown }) : null;
    await this.recorder.event({
      kind: "agent_finished",
      stage,
      agentId: role,
      promptVersion: instructions.version,
      data: { ok: result.ok, reason: result.reason, turns: result.turns, durationMs: result.durationMs, usage: result.usage, status: outputStatus?.status ?? outputStatus?.verdict ?? null },
    });
    return { result, output: parsed.success ? parsed.data : null };
  }

  async sandboxExec(stage: string, name: string, command: string, cwd?: string): Promise<ExecResult> {
    if (!this.sandbox) throw new Error("sandbox not ready");
    const startedAt = new Date();
    const result = await this.sandbox.exec({ command, timeoutMs: this.contract.budgets.commandTimeoutSeconds * 1000, ...(cwd ? { cwd } : {}) });
    await this.recorder.command({
      stage,
      name,
      command,
      cwd: cwd ?? "/workspace",
      startedAt,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      errorCategory: errorCategory(result),
      outputHash: result.outputHash,
      output: result.output,
    });
    return result;
  }

  async runChecks(plan: CheckPlan, stage: Stage, label: string): Promise<CheckOutcome[]> {
    const outcomes: CheckOutcome[] = [];
    for (const check of plan.checks) {
      this.throwIfStopped();
      const result = await this.sandboxExec(stage, check.name, check.command);
      outcomes.push({ name: check.name, command: check.command, exitCode: result.exitCode, passed: result.exitCode === 0, durationMs: result.durationMs, result });
    }
    await writeArtifact(this.repo, this.claimed.id, `${label}.json`, JSON.stringify(outcomes.map(record), null, 2));
    return outcomes;
  }

  /** Final verification evidence; a check that already failed at the refactor baseline is not blamed. */
  async verifyChecks(plan: CheckPlan, stage: Stage, label: string) {
    const outcomes = await this.runChecks(plan, stage, label);
    this.verification.splice(0, this.verification.length, ...outcomes.map(({ result: _r, ...rest }) => rest));
    const preexisting = new Set((this.data.baseline ?? []).filter((b) => !b.passed).map((b) => b.name));
    const blamed = outcomes.filter((o) => !o.passed && !preexisting.has(o.name));
    const notBlamed = outcomes.filter((o) => !o.passed && preexisting.has(o.name)).map((o) => o.name);
    await this.recorder.event({ kind: "checks_finished", stage, data: { label, notBlamed, results: outcomes.map((o) => ({ name: o.name, exitCode: o.exitCode, durationMs: o.durationMs })) } });
    return { outcomes, blamed, notBlamed };
  }
}

/** The profile-specific evidence task.md shows: baseline, reproduction, review, deploy impact. */
function evidenceSections(data: RunData, verification: TaskView["verification"]): NonNullable<TaskView["sections"]> {
  const sections: NonNullable<TaskView["sections"]> = [];
  const passedNow = (name: string) => verification.find((v) => v.name === name)?.passed;
  if (data.baseline) {
    sections.push({
      heading: "Baseline",
      lines: data.baseline.map((b) => `- ${b.name}: ${b.passed ? "pass" : "FAIL (pre-existing, not blamed on this run)"} at the base commit, output \`${b.outputHash.slice(0, 12)}\``),
    });
  }
  if (data.reproduce) {
    const r = data.reproduce;
    sections.push({
      heading: "Reproduction",
      lines:
        r.status === "reproduced"
          ? [
              `- Regression test: ${r.testFiles.map((f) => `\`${f}\``).join(", ")}`,
              ...r.failing.map((f) => {
                const after = passedNow(f.name);
                const now = after === undefined ? "" : after ? "; passes after the fix" : "; still failing";
                return `- \`${f.command}\` failed before the fix (exit ${f.exitCode}, output \`${f.outputHash.slice(0, 12)}\`)${now}`;
              }),
            ]
          : [`- Not reproduced by a test: ${r.reason}`],
    });
  }
  if (data.review) {
    sections.push({
      heading: "Independent review",
      lines: [...renderReview(data.review), ...(data.reviewRepair ? [`- One repair pass made: \`${data.reviewRepair.sha.slice(0, 12)}\``] : [])],
    });
  }
  if (data.deployImpact) sections.push({ heading: "Deploy impact", lines: renderDeployImpact(data.deployImpact) });
  return sections;
}

export function usageTotals(usage: AgentUsage[]): Record<string, number | null> {
  const costs = usage.map((u) => u.estimatedCostUsd);
  return {
    inputTokens: usage.reduce((sum, u) => sum + u.inputTokens, 0),
    outputTokens: usage.reduce((sum, u) => sum + u.outputTokens, 0),
    cacheReadTokens: usage.reduce((sum, u) => sum + u.cacheReadTokens, 0),
    estimatedCostUsd: costs.some((c) => c === null) ? null : costs.reduce<number>((sum, c) => sum + (c ?? 0), 0),
  };
}

function summariseUsage(usage: AgentUsage[]): TaskView["usage"] {
  if (usage.length === 0) return undefined;
  const totals = usageTotals(usage);
  return {
    estimatedCostUsd: totals.estimatedCostUsd ?? null,
    inputTokens: totals.inputTokens ?? 0,
    outputTokens: totals.outputTokens ?? 0,
    note: "runtime estimate; notional when running on a subscription",
  };
}
