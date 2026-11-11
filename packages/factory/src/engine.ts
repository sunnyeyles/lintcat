/** The deterministic orchestrator: agents reason, this code owns state, checks and delivery. */
import path from "node:path";

import { collectRun, type AgentResult, type AgentRuntime, type AgentUsage } from "@pr-review/agent-runtime";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import { z } from "zod";

import { detectChecks, type CheckPlan } from "#src/checks";
import { assertFrozen, recordDecision, type TaskContract } from "#src/contract";
import {
  checkpointCommit,
  createWorktree,
  dirtyPaths,
  headSha,
  isClean,
  pushBranch,
  resetTo,
  slugify,
  squashSince,
} from "#src/git";
import { locate } from "#src/locate";
import { loadProfile, workflowVersion, type Stage } from "#src/profiles";
import { loadPrompt } from "#src/prompts";
import { writeArtifact, writeRunFiles, type TaskView } from "#src/run-files";
import { DEFAULT_LIMITS, SANDBOX_IMAGE, type ExecResult, type Sandbox, type SandboxProvider } from "#src/sandbox/index";
import {
  findEffect,
  noteRecovery,
  recordEffect,
  renewLease,
  saveProgress,
  settleRun,
  type Checkpoint,
  type FactoryDatabase,
  type FactoryRun,
  type RunOutcome,
} from "#src/store/index";
import { createRecorder } from "#src/telemetry";

const MAX_RECOVERIES = 3;

interface PullRequestRequest {
  repoPath: string;
  branch: string;
  base: string | null;
  title: string;
  body: string;
}

export interface EngineDeps {
  database: FactoryDatabase;
  runtime: AgentRuntime;
  sandboxes: SandboxProvider;
  logger: StructuredLogger;
  delivery: "branch" | "pr";
  leaseMs?: number;
  heartbeatMs?: number;
  /** Finds an open PR for the branch first, so a retry never opens a second. */
  openPullRequest?: (request: PullRequestRequest) => Promise<{ url: string }>;
  sandboxImage?: string;
}

const implementerOutputSchema = z.object({
  status: z.enum(["done", "partial", "blocked"]),
  summary: z.string(),
  decisions: z.array(z.string()),
  acceptance: z.array(z.object({ id: z.string(), coverage: z.string() })),
  blockers: z.array(z.string()),
});
type ImplementerOutput = z.infer<typeof implementerOutputSchema>;

class RunStopped extends Error {
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

const tail = (text: string, chars: number) => (text.length > chars ? `…${text.slice(-chars)}` : text);

function implementPrompt(contract: TaskContract, located: unknown, plan: CheckPlan): string {
  const { spec } = contract;
  return [
    `# Task: ${spec.title}`,
    `Objective: ${spec.objective}`,
    "## Approved specification (frozen)",
    "```json",
    JSON.stringify(
      {
        requirements: spec.requirements,
        acceptanceCriteria: spec.acceptanceCriteria,
        nonGoals: spec.nonGoals,
        constraints: spec.constraints,
        plan: spec.plan,
        architectureDecisions: spec.architectureDecisions,
        assumptions: spec.assumptions,
      },
      null,
      2,
    ),
    "```",
    "## Where to look first",
    "```json",
    JSON.stringify(located, null, 2),
    "```",
    "## Checks the factory runs afterwards (all must pass)",
    ...plan.checks.map((c) => `- ${c.name}: \`${c.command}\``),
    "",
    "Implement the task now. Use `sandbox_exec` for targeted checks.",
  ].join("\n");
}

function repairPrompt(failures: CheckOutcome[], pass: number, max: number): string {
  return [
    `Repair pass ${pass} of ${max}. These mandatory checks failed after your change:`,
    ...failures.map((f) =>
      [`## ${f.name} (exit ${f.exitCode}${f.result.timedOut ? ", timed out" : ""})`, "```", tail(f.result.output, 6000), "```"].join("\n"),
    ),
    "Fix the cause, rerun the failing checks with `sandbox_exec`, then give your final answer.",
  ].join("\n");
}

function errorCategory(result: ExecResult): string | null {
  if (result.timedOut) return "timeout";
  if (result.exitCode === 137) return "killed";
  if (result.exitCode === 127) return "command_not_found";
  return result.exitCode === 0 ? null : "nonzero_exit";
}

/** Runs one claimed run to a terminal state; never throws for run-level failures. */
export async function executeRun(deps: EngineDeps, claimed: FactoryRun): Promise<FactoryRun["status"]> {
  const { database, logger } = deps;
  const leaseMs = deps.leaseMs ?? 60_000;
  const heartbeatMs = deps.heartbeatMs ?? 5_000;
  let contract = claimed.contract;
  const profile = loadProfile(contract.profile);
  const recorder = createRecorder(
    database,
    { runId: claimed.id, taskId: contract.taskId, repoPath: claimed.repoPath, workflowVersion: workflowVersion(profile) },
    logger,
  );
  const repo = claimed.repoPath;
  const worktree = claimed.worktreePath ?? path.join(repo, ".factory", "worktrees", claimed.id);
  const branch = claimed.branch ?? `factory/${slugify(contract.spec.title)}-${claimed.id.slice(-6)}`;
  const progress: TaskView["progress"] = [];
  const verification: TaskView["verification"] = [];
  const deviations: string[] = [];
  const usage: AgentUsage[] = [];
  let checkpoint: Checkpoint | null = claimed.checkpoint ?? null;
  let sessionId = claimed.agentSessionId ?? undefined;
  let status: FactoryRun["status"] = "running";
  let currentStage: Stage | null = null;
  let sandbox: Sandbox | undefined;
  let setupPaths: string[] = [];

  const abort = new AbortController();
  const stopWith = (reason: RunStopped) => {
    if (!abort.signal.aborted) abort.abort(reason);
    void sandbox?.kill().catch(() => {});
  };
  const throwIfStopped = () => {
    if (abort.signal.aborted) throw abort.signal.reason instanceof RunStopped ? abort.signal.reason : new RunStopped("failed", "aborted");
  };

  const heartbeat = setInterval(() => {
    renewLease(database, claimed.id, leaseMs)
      .then(({ alive, cancelRequested }) => {
        if (cancelRequested) stopWith(new RunStopped("cancelled", "cancelled by request"));
        else if (!alive) stopWith(new RunStopped("failed", "lease lost to another worker"));
      })
      .catch((error: unknown) => logger.error("lease renewal failed", { error: errorMessage(error) }));
  }, heartbeatMs);
  const deadline = setTimeout(
    () => stopWith(new RunStopped("failed", `wall-clock budget of ${contract.budgets.wallClockMinutes} min exceeded`)),
    contract.budgets.wallClockMinutes * 60_000,
  );

  const sync = async (outcome: TaskView["outcome"] = null, blockers: string[] = []) => {
    const view: TaskView = {
      runId: claimed.id,
      status,
      stage: currentStage,
      profile: profile.name,
      contract,
      progress,
      verification,
      deviations,
      blockers,
      outcome,
      usage: summariseUsage(usage),
    };
    const { conflict } = await writeRunFiles(repo, claimed.id, {
      view,
      state: { runId: claimed.id, status, stage: currentStage, branch, worktree, checkpoint, sessionId },
    });
    if (conflict) await recorder.event({ kind: "task_md_conflict", data: { preservedAs: "task.user-edit.md" } });
  };

  const save = async (next: Checkpoint) => {
    checkpoint = next;
    await saveProgress(database, claimed.id, { checkpoint: next, stage: next.nextStage, ...(sessionId ? { agentSessionId: sessionId } : {}) });
  };

  const runAgent = async (stage: Stage, prompt: string, resume: boolean): Promise<{ result: AgentResult; output: ImplementerOutput | null }> => {
    const instructions = loadPrompt("implementer");
    const result = await collectRun(
      deps.runtime.run({
        role: "implementer",
        promptVersion: instructions.version,
        systemPrompt: instructions.text,
        prompt,
        cwd: worktree,
        readOnly: false,
        maxTurns: contract.budgets.maxAgentTurns,
        outputSchema: z.toJSONSchema(implementerOutputSchema) as Record<string, unknown>,
        signal: abort.signal,
        tools: [
          {
            name: "sandbox_exec",
            description:
              "Run a shell command in the offline sandbox with the worktree at /workspace. Returns exit code and output.",
            input: { command: z.string().min(1), cwd: z.string().optional() },
            handler: async (args) => {
              const result = await sandboxExec(stage, "agent", String(args.command), typeof args.cwd === "string" ? args.cwd : undefined);
              return { text: `exit ${result.exitCode}${result.timedOut ? " (timed out)" : ""}\n${result.output}`, isError: result.exitCode !== 0 };
            },
          },
        ],
        ...(resume && sessionId ? { resumeSessionId: sessionId } : {}),
      }),
      async (event) => {
        if (event.type === "session") sessionId = event.sessionId;
        if (event.type === "auth") {
          await recorder.event({ kind: "agent_auth", stage, agentId: "implementer", promptVersion: instructions.version, data: { ...event } });
        }
      },
    );
    usage.push(result.usage);
    const parsed = implementerOutputSchema.safeParse(result.structured);
    await recorder.event({
      kind: "agent_finished",
      stage,
      agentId: "implementer",
      promptVersion: instructions.version,
      data: { ok: result.ok, reason: result.reason, turns: result.turns, durationMs: result.durationMs, usage: result.usage, status: parsed.success ? parsed.data.status : null },
    });
    return { result, output: parsed.success ? parsed.data : null };
  };

  const sandboxExec = async (stage: string, name: string, command: string, cwd?: string): Promise<ExecResult> => {
    if (!sandbox) throw new Error("sandbox not ready");
    const startedAt = new Date();
    const result = await sandbox.exec({ command, timeoutMs: contract.budgets.commandTimeoutSeconds * 1000, ...(cwd ? { cwd } : {}) });
    await recorder.command({
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
  };

  const runChecks = async (plan: CheckPlan, label: string): Promise<CheckOutcome[]> => {
    const outcomes: CheckOutcome[] = [];
    for (const check of plan.checks) {
      throwIfStopped();
      const result = await sandboxExec("verify", check.name, check.command);
      outcomes.push({ name: check.name, command: check.command, exitCode: result.exitCode, passed: result.exitCode === 0, durationMs: result.durationMs, result });
    }
    verification.splice(0, verification.length, ...outcomes.map(({ result: _r, ...rest }) => rest));
    await writeArtifact(repo, claimed.id, `verify-${label}.json`, JSON.stringify(verification, null, 2));
    return outcomes;
  };

  const mark = (stage: string, state: TaskView["progress"][number]["status"], note?: string) => {
    const existing = progress.find((p) => p.stage === stage);
    if (existing) Object.assign(existing, { status: state, ...(note ? { note } : {}) });
    else progress.push({ stage, status: state, ...(note ? { note } : {}) });
  };

  try {
    assertFrozen(contract);
    if (!profile.enabled) throw new RunStopped("failed", `profile ${profile.name} is not enabled`);

    const recovering = checkpoint !== null || claimed.attempts > 1;
    if (recovering) {
      const recoveries = await noteRecovery(database, claimed.id);
      await recorder.event({ kind: "recovery_started", data: { recoveries, checkpoint } });
      if (recoveries > MAX_RECOVERIES) throw new RunStopped("failed", `gave up after ${MAX_RECOVERIES} recoveries`);
    }
    await recorder.event({ kind: "run_started", data: { attempt: claimed.attempts, profile: profile.name, branch } });

    const plan = await detectChecks(repo);
    if (plan.checks.length === 0) {
      throw new RunStopped("failed", "no checks detected: add .factory/checks so the change can be verified");
    }
    const startIndex = checkpoint ? profile.stages.indexOf(checkpoint.nextStage as Stage) : 0;
    if (startIndex < 0) throw new RunStopped("failed", `checkpoint names unknown stage ${checkpoint?.nextStage}`);
    for (const stage of profile.stages.slice(0, startIndex)) mark(stage, "done", "before recovery");

    // Prepare always reruns: the sandbox is disposable and the worktree must match the checkpoint.
    currentStage = "prepare";
    await recorder.stage("prepare", async () => {
      mark("prepare", "running");
      await saveProgress(database, claimed.id, { stage: "prepare", branch, worktreePath: worktree });
      const { created } = await createWorktree(repo, { path: worktree, branch, baseSha: contract.baseSha });
      const target = checkpoint?.sha ?? contract.baseSha;
      if (!created && ((await headSha(worktree)) !== target || !(await isClean(worktree)))) {
        await resetTo(worktree, target);
        await recorder.event({ kind: "worktree_reconciled", stage: "prepare", repositorySha: target });
      }
      sandbox = await deps.sandboxes.create({ runId: claimed.id, worktreePath: worktree, image: deps.sandboxImage ?? SANDBOX_IMAGE, limits: DEFAULT_LIMITS });
      if (plan.install) {
        const startedAt = new Date();
        const result = await sandbox.setup({ command: plan.install, timeoutMs: contract.budgets.commandTimeoutSeconds * 1000 });
        await recorder.command({ stage: "prepare", name: "install", command: plan.install, cwd: "/workspace", startedAt, durationMs: result.durationMs, exitCode: result.exitCode, timedOut: result.timedOut, errorCategory: errorCategory(result), outputHash: result.outputHash, output: result.output });
        if (result.exitCode !== 0) throw new RunStopped("failed", `dependency install failed (exit ${result.exitCode})`);
      }
      await sandbox.isolate();
      // Install output (lockfiles, node_modules in a repo that doesn't ignore it) is not the agent's change.
      setupPaths = await dirtyPaths(worktree);
      if (setupPaths.length > 0) {
        deviations.push(`left out of the delivery, written by dependency install: ${setupPaths.join(", ")}`);
        await recorder.event({ kind: "setup_paths_excluded", stage: "prepare", data: { paths: setupPaths } });
      }
      await recorder.event({ kind: "sandbox_ready", stage: "prepare", data: { sandbox: deps.sandboxes.name, image: deps.sandboxImage ?? SANDBOX_IMAGE, limits: DEFAULT_LIMITS, network: "none" } });
      mark("prepare", "done");
    });
    await sync();

    let located: unknown = checkpoint?.data?.locate ?? null;
    let delivered: RunOutcome | undefined;
    let repairs = Number(checkpoint?.data?.repairs ?? 0);

    for (const stage of profile.stages.slice(Math.max(startIndex, 1))) {
      throwIfStopped();
      currentStage = stage;
      mark(stage, "running");
      await saveProgress(database, claimed.id, { stage, ...(stage === "verify" ? { status: "verifying" } : {}) });
      if (stage === "verify") status = "verifying";
      await sync();

      await recorder.stage(stage, async () => {
        if (stage === "locate") {
          located = await locate(worktree, contract.spec);
          await writeArtifact(repo, claimed.id, "locate.json", JSON.stringify(located, null, 2));
          await save({ stage, sha: await headSha(worktree), nextStage: "implement", data: { locate: located } });
          return;
        }

        if (stage === "implement") {
          const { result, output } = await runAgent(stage, implementPrompt(contract, located, plan), false);
          throwIfStopped();
          if (!result.ok) throw new RunStopped("failed", `implementer ended with ${result.reason}`);
          if (output) {
            for (const decision of output.decisions) contract = recordDecision(contract, stage, decision, new Date());
            await saveProgress(database, claimed.id, { contract });
            if (output.status === "blocked") throw new RunStopped("failed", `implementer blocked: ${output.blockers.join("; ") || output.summary}`);
            if (output.status === "partial") deviations.push(`implementer reported partial: ${output.summary}`);
          } else {
            deviations.push("implementer's final answer did not match its schema");
          }
          const sha = await checkpointCommit(worktree, `factory: implement ${contract.spec.title}`, undefined, setupPaths);
          if (!sha) throw new RunStopped("failed", "the implementer made no changes");
          await save({ stage, sha, nextStage: "verify", data: { locate: located, repairs, summary: output?.summary ?? "" } });
          return;
        }

        if (stage === "verify") {
          let previousSignature: string | null = null;
          for (;;) {
            const outcomes = await runChecks(plan, `${repairs}`);
            const failures = outcomes.filter((o) => !o.passed);
            await recorder.event({ kind: "checks_finished", stage, data: { repairs, results: outcomes.map((o) => ({ name: o.name, exitCode: o.exitCode, durationMs: o.durationMs })) } });
            if (failures.length === 0) break;
            const signature = failures.map((f) => `${f.name}:${f.result.outputHash}`).sort().join("|");
            if (signature === previousSignature) {
              await recorder.event({ kind: "repeated_failure", stage, data: { signature } });
              throw new RunStopped("failed", `the same checks failed identically after repair: ${failures.map((f) => f.name).join(", ")}`);
            }
            if (repairs >= contract.budgets.maxRepairPasses) {
              throw new RunStopped("failed", `mandatory checks still failing after ${repairs} repair pass(es): ${failures.map((f) => f.name).join(", ")}`);
            }
            previousSignature = signature;
            repairs++;
            await recorder.event({ kind: "repair_started", stage, data: { pass: repairs, failing: failures.map((f) => f.name) } });
            const { result } = await runAgent(stage, repairPrompt(failures, repairs, contract.budgets.maxRepairPasses), true);
            throwIfStopped();
            if (!result.ok) throw new RunStopped("failed", `repair agent ended with ${result.reason}`);
            const sha = await checkpointCommit(worktree, `factory: repair pass ${repairs}`, undefined, setupPaths);
            if (!sha) throw new RunStopped("failed", `repair pass ${repairs} changed nothing`);
            await save({ stage, sha, nextStage: "verify", data: { locate: located, repairs } });
          }
          await save({ stage, sha: await headSha(worktree), nextStage: "deliver", data: { locate: located, repairs } });
          return;
        }

        if (stage === "deliver") {
          delivered = await deliver();
          return;
        }

        throw new RunStopped("failed", `stage ${stage} is not implemented in this version`);
      });
      mark(stage, "done");
    }

    status = "delivered";
    const outcome: RunOutcome = { ...(delivered ?? { summary: "delivered", branch }), usage: usageTotals(usage) };
    await settleRun(database, claimed.id, { status: "delivered", outcome });
    await recorder.event({ kind: "run_delivered", data: { branch, pullRequestUrl: outcome.pullRequestUrl ?? null } });
    await sync({ summary: outcome.summary, branch, ...(outcome.pullRequestUrl ? { pullRequestUrl: outcome.pullRequestUrl } : {}) });
    return status;
  } catch (error) {
    const stopped = error instanceof RunStopped ? error : abort.signal.reason instanceof RunStopped ? abort.signal.reason : null;
    status = stopped?.status ?? "failed";
    const blocker = stopped?.blocker ?? `unexpected error: ${errorMessage(error)}`;
    if (currentStage) mark(currentStage, "failed", blocker);
    await settleRun(database, claimed.id, {
      status,
      blocker,
      outcome: { summary: blocker, branch, checks: verification.map((v) => ({ name: v.name, exitCode: v.exitCode, passed: v.passed })), usage: usageTotals(usage) },
    }).catch((settleError: unknown) => logger.error("settle failed", { error: errorMessage(settleError) }));
    await recorder.event({ kind: status === "cancelled" ? "run_cancelled" : "run_failed", ...(currentStage ? { stage: currentStage } : {}), data: { blocker } }).catch(() => {});
    await sync({ summary: blocker, branch }, [blocker]).catch(() => {});
    return status;
  } finally {
    clearInterval(heartbeat);
    clearTimeout(deadline);
    await sandbox?.destroy().catch(() => {});
  }

  async function deliver() {
    const body = [
      contract.spec.objective,
      "",
      ...contract.spec.acceptanceCriteria.map((ac) => `- ${ac.id}: ${ac.text}`),
    ].join("\n");
    const sha = await squashSince(worktree, contract.baseSha, `${contract.spec.title}\n\n${body}`);
    await recordEffect(database, { key: `branch:${claimed.id}`, runId: claimed.id, kind: "branch", result: { branch, sha } });
    const outcome: RunOutcome = {
      summary: `Branch ${branch} at ${sha.slice(0, 12)}, all ${verification.length} checks passed.`,
      branch,
      checks: verification.map((v) => ({ name: v.name, exitCode: v.exitCode, passed: v.passed })),
    };
    const wantsPr = deps.delivery === "pr" && contract.permittedOperations.push && contract.permittedOperations.openPullRequest;
    if (wantsPr && deps.openPullRequest) {
      const pushKey = `push:${claimed.id}:${sha}`;
      if (!(await findEffect(database, pushKey))) {
        await pushBranch(worktree, "origin", branch);
        await recordEffect(database, { key: pushKey, runId: claimed.id, kind: "push", result: { branch, sha } });
      }
      const prKey = `pr:${claimed.id}`;
      const existing = await findEffect(database, prKey);
      const url = existing
        ? String((existing.result as { url: string }).url)
        : (await deps.openPullRequest({ repoPath: repo, branch, base: contract.baseBranch, title: contract.spec.title, body })).url;
      if (!existing) await recordEffect(database, { key: prKey, runId: claimed.id, kind: "pull_request", result: { url } });
      outcome.pullRequestUrl = url;
    } else if (deps.delivery === "pr") {
      deviations.push("PR delivery skipped: the approved contract does not permit push and PR, or no GitHub client is configured");
    }
    await saveProgress(database, claimed.id, { checkpoint: { stage: "deliver", sha, nextStage: "deliver" } });
    return outcome;
  }
}

function usageTotals(usage: AgentUsage[]): Record<string, number | null> {
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
