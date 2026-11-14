/** The deterministic orchestrator: agents reason, this code owns state, checks and delivery. */
import { existsSync } from "node:fs";
import path from "node:path";

import { collectRun, type AgentResult, type AgentRuntime, type AgentUsage } from "@pr-review/agent-runtime";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import { z } from "zod";

import { detectChecks, type CheckPlan } from "#src/checks";
import { assertFrozen, recordDecision } from "#src/contract";
import { assessEscalation } from "#src/escalation";
import {
  changedFiles,
  checkpointCommit,
  committedDiff,
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
import { loadProfile, workflowVersion, type Profile, type Stage } from "#src/profiles";
import { loadPrompt } from "#src/prompts";
import { refactorOutcome, refactorSuggestionsSchema, renderRefactors, validateRefactors } from "#src/refactors";
import { analyseRepository, isTestPath, renderArchitecture, type ArchitectureBrief } from "#src/repository";
import { renderReview, reviewOutputSchema, reviewPrompt, reviewRepairPrompt, validateReview, type ValidatedReview } from "#src/review";
import { writeArtifact, writeRunFiles, type TaskView } from "#src/run-files";
import { DEFAULT_LIMITS, SANDBOX_IMAGE, type ExecResult, type Sandbox, type SandboxProvider } from "#src/sandbox/index";
import { implementPrompt, repairPrompt, reproducePrompt } from "#src/stage-prompts";
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
import type { RefactorSuggestion } from "#src/store/schema";
import { createRecorder } from "#src/telemetry";

const MAX_RECOVERIES = 3;
/** Escalating to a review needs at least this share of the wall-clock budget left. */
const ESCALATION_BUDGET_SHARE = 0.25;

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

const placedOutputSchema = implementerOutputSchema.extend({
  placement: z.object({ location: z.string().min(1), reuse: z.array(z.string()), rationale: z.string().min(1) }),
});

const bugfixOutputSchema = implementerOutputSchema.extend({ refactors: refactorSuggestionsSchema });

const reproduceOutputSchema = z.object({
  status: z.enum(["reproduced", "not_reproducible"]),
  summary: z.string(),
  reason: z.string(),
  decisions: z.array(z.string()),
});

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

type CheckRecord = { name: string; command: string; exitCode: number; passed: boolean; outputHash: string };

/** Everything a stage hands on, persisted in the checkpoint so recovery never redoes it. */
interface RunData {
  locate?: unknown;
  architecture?: ArchitectureBrief;
  repairs?: number;
  summary?: string;
  baseline?: CheckRecord[];
  reproduce?: { status: "reproduced"; testFiles: string[]; failing: CheckRecord[] } | { status: "not_reproducible"; reason: string };
  escalation?: { reason: string };
  review?: ValidatedReview;
  reviewRepair?: { sha: string };
  refactors?: RefactorSuggestion[];
  turnsUsed?: number;
}

const record = (o: CheckOutcome): CheckRecord => ({ name: o.name, command: o.command, exitCode: o.exitCode, passed: o.passed, outputHash: o.result.outputHash });

function errorCategory(result: ExecResult): string | null {
  if (result.timedOut) return "timeout";
  if (result.exitCode === 137) return "killed";
  if (result.exitCode === 127) return "command_not_found";
  return result.exitCode === 0 ? null : "nonzero_exit";
}

/** The profile's stages, plus a review before delivery once a run has escalated. */
function stagesOf(profile: Profile, data: RunData): Stage[] {
  if (!data.escalation || profile.stages.includes("review")) return profile.stages;
  const at = profile.stages.indexOf("deliver");
  return [...profile.stages.slice(0, at), "review", ...profile.stages.slice(at)];
}

/** Runs one claimed run to a terminal state; never throws for run-level failures. */
export async function executeRun(deps: EngineDeps, claimed: FactoryRun): Promise<FactoryRun["status"]> {
  const { database, logger } = deps;
  const leaseMs = deps.leaseMs ?? 60_000;
  const heartbeatMs = deps.heartbeatMs ?? 5_000;
  const startedAt = Date.now();
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
  const data: RunData = { ...((checkpoint?.data ?? {}) as RunData) };
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
      profile: data.escalation ? `${profile.name} (escalated: + review)` : profile.name,
      contract,
      progress,
      verification,
      deviations,
      blockers,
      outcome,
      usage: summariseUsage(usage),
      sections: evidenceSections(data, verification),
    };
    const { conflict } = await writeRunFiles(repo, claimed.id, {
      view,
      state: { runId: claimed.id, status, stage: currentStage, branch, worktree, checkpoint, sessionId },
    });
    if (conflict) await recorder.event({ kind: "task_md_conflict", data: { preservedAs: "task.user-edit.md" } });
  };

  const save = async (stage: Stage, nextStage: Stage, sha?: string) => {
    const next: Checkpoint = { stage, sha: sha ?? (await headSha(worktree)), nextStage, data: { ...data } as Record<string, unknown> };
    checkpoint = next;
    await saveProgress(database, claimed.id, { checkpoint: next, stage: nextStage, contract, ...(sessionId ? { agentSessionId: sessionId } : {}) });
  };

  const decide = (stage: Stage, decision: string) => {
    contract = recordDecision(contract, stage, decision, new Date());
  };

  const runAgent = async <S extends z.ZodType>(
    stage: Stage,
    prompt: string,
    options: { role: "implementer" | "reviewer"; resume: boolean; schema: S },
  ): Promise<{ result: AgentResult; output: z.infer<S> | null }> => {
    const { role, resume, schema } = options;
    const instructions = loadPrompt(role);
    const implementer = role === "implementer";
    // Implement and every repair pass draw on one turn budget; the reviewer gets its own.
    const turnsLeft = implementer ? contract.budgets.maxAgentTurns - (data.turnsUsed ?? 0) : contract.budgets.maxAgentTurns;
    if (turnsLeft <= 0) throw new RunStopped("failed", `agent turn budget of ${contract.budgets.maxAgentTurns} spent`);
    const result = await collectRun(
      deps.runtime.run({
        role,
        promptVersion: instructions.version,
        systemPrompt: instructions.text,
        prompt,
        cwd: worktree,
        readOnly: !implementer,
        maxTurns: turnsLeft,
        outputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
        signal: abort.signal,
        tools: implementer
          ? [
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
            ]
          : [],
        ...(implementer && resume && sessionId ? { resumeSessionId: sessionId } : {}),
      }),
      async (event) => {
        // The reviewer's session is disposable; only the implementer's is ever resumed.
        if (event.type === "session" && implementer) sessionId = event.sessionId;
        if (event.type === "auth") {
          await recorder.event({ kind: "agent_auth", stage, agentId: role, promptVersion: instructions.version, data: { ...event } });
        }
      },
    );
    usage.push(result.usage);
    if (implementer) data.turnsUsed = (data.turnsUsed ?? 0) + result.turns;
    const parsed = schema.safeParse(result.structured);
    const outputStatus = parsed.success ? (parsed.data as { status?: unknown; verdict?: unknown }) : null;
    await recorder.event({
      kind: "agent_finished",
      stage,
      agentId: role,
      promptVersion: instructions.version,
      data: { ok: result.ok, reason: result.reason, turns: result.turns, durationMs: result.durationMs, usage: result.usage, status: outputStatus?.status ?? outputStatus?.verdict ?? null },
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

  const runChecks = async (plan: CheckPlan, stage: Stage, label: string): Promise<CheckOutcome[]> => {
    const outcomes: CheckOutcome[] = [];
    for (const check of plan.checks) {
      throwIfStopped();
      const result = await sandboxExec(stage, check.name, check.command);
      outcomes.push({ name: check.name, command: check.command, exitCode: result.exitCode, passed: result.exitCode === 0, durationMs: result.durationMs, result });
    }
    await writeArtifact(repo, claimed.id, `${label}.json`, JSON.stringify(outcomes.map(record), null, 2));
    return outcomes;
  };

  /** Final verification evidence; a check that already failed at the refactor baseline is not blamed. */
  const verifyChecks = async (plan: CheckPlan, stage: Stage, label: string) => {
    const outcomes = await runChecks(plan, stage, label);
    verification.splice(0, verification.length, ...outcomes.map(({ result: _r, ...rest }) => rest));
    const preexisting = new Set((data.baseline ?? []).filter((b) => !b.passed).map((b) => b.name));
    const blamed = outcomes.filter((o) => !o.passed && !preexisting.has(o.name));
    const notBlamed = outcomes.filter((o) => !o.passed && preexisting.has(o.name)).map((o) => o.name);
    await recorder.event({ kind: "checks_finished", stage, data: { label, notBlamed, results: outcomes.map((o) => ({ name: o.name, exitCode: o.exitCode, durationMs: o.durationMs })) } });
    return { outcomes, blamed, notBlamed };
  };

  const withoutSetup = (files: string[]) =>
    files.filter((f) => !setupPaths.some((p) => f === p || (p.endsWith("/") && f.startsWith(p))));

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
    let stages = stagesOf(profile, data);
    const startIndex = checkpoint ? stages.indexOf(checkpoint.nextStage as Stage) : 0;
    if (startIndex < 0) throw new RunStopped("failed", `checkpoint names unknown stage ${checkpoint?.nextStage}`);
    for (const stage of stages.slice(0, startIndex)) mark(stage, "done", "before recovery");

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

    let delivered: RunOutcome | undefined;
    data.repairs ??= 0;
    const needsPlacement = profile.name === "feature" || profile.name === "refactor";
    const suggestsRefactors = profile.name === "bugfix";

    for (let i = Math.max(startIndex, 1); i < stages.length; i++) {
      const stage = stages[i]!;
      throwIfStopped();
      currentStage = stage;
      mark(stage, "running");
      await saveProgress(database, claimed.id, { stage, ...(stage === "verify" ? { status: "verifying" } : {}) });
      if (stage === "verify") status = "verifying";
      await sync();

      await recorder.stage(stage, async () => {
        if (stage === "locate") {
          const located = await locate(worktree, contract.spec);
          data.locate = located;
          await writeArtifact(repo, claimed.id, "locate.json", JSON.stringify(located, null, 2));
          if (needsPlacement) {
            data.architecture = await analyseRepository(worktree, located);
            await writeArtifact(repo, claimed.id, "architecture.md", renderArchitecture(data.architecture));
            await writeArtifact(repo, claimed.id, "architecture.json", JSON.stringify(data.architecture, null, 2));
          }
          await save(stage, stages[i + 1]!);
          return;
        }

        if (stage === "baseline") {
          const outcomes = await runChecks(plan, stage, "baseline");
          data.baseline = outcomes.map(record);
          await recorder.event({ kind: "baseline_recorded", stage, data: { results: data.baseline } });
          if (!outcomes.some((o) => o.passed)) {
            throw new RunStopped("failed", "no check passes at the base commit, so the refactor could not be shown to preserve behaviour");
          }
          await save(stage, stages[i + 1]!);
          return;
        }

        if (stage === "reproduce") {
          await reproduce(stage, plan, stages[i + 1]!);
          return;
        }

        if (stage === "implement") {
          const reproduced = data.reproduce?.status === "reproduced" ? data.reproduce : undefined;
          const prompt = implementPrompt(
            contract,
            {
              located: data.locate ?? null,
              architecture: data.architecture,
              regression: reproduced ? { testFiles: reproduced.testFiles, failing: reproduced.failing.map((f) => f.name) } : undefined,
              baselineFailing: data.baseline?.filter((b) => !b.passed).map((b) => b.name),
              placement: needsPlacement,
              suggestRefactors: suggestsRefactors,
            },
            plan,
          );
          const schema = needsPlacement ? placedOutputSchema : suggestsRefactors ? bugfixOutputSchema : implementerOutputSchema;
          const { result, output } = await runAgent(stage, prompt, { role: "implementer", resume: reproduced !== undefined, schema });
          throwIfStopped();
          if (!result.ok) throw new RunStopped("failed", `implementer ended with ${result.reason}`);
          if (output) {
            for (const decision of output.decisions) decide(stage, decision);
            if ("placement" in output) {
              const { location, reuse, rationale } = output.placement as z.infer<typeof placedOutputSchema>["placement"];
              decide(stage, `placement: ${location} (${rationale})`);
              decide(stage, `reuse: ${reuse.length ? reuse.join(", ") : "no existing module reused"}`);
            }
            if ("refactors" in output) {
              data.refactors = validateRefactors(output.refactors as z.infer<typeof refactorSuggestionsSchema>);
              await writeArtifact(repo, claimed.id, "refactors.json", JSON.stringify(data.refactors, null, 2));
              await recorder.event({ kind: "refactors_suggested", stage, data: { count: data.refactors.length } });
            }
            await saveProgress(database, claimed.id, { contract });
            if (output.status === "blocked") throw new RunStopped("failed", `implementer blocked: ${output.blockers.join("; ") || output.summary}`);
            if (output.status === "partial") deviations.push(`implementer reported partial: ${output.summary}`);
          } else {
            deviations.push(
              needsPlacement
                ? "implementer's final answer did not match its schema, so no placement or reuse justification was recorded"
                : "implementer's final answer did not match its schema",
            );
          }
          const sha = await checkpointCommit(worktree, `factory: implement ${contract.spec.title}`, undefined, setupPaths);
          if (!sha) throw new RunStopped("failed", "the implementer made no changes");
          const missing = (reproduced?.testFiles ?? []).filter((f) => !existsSync(path.join(worktree, f)));
          if (missing.length) throw new RunStopped("failed", `the fix deleted the regression test: ${missing.join(", ")}`);
          data.summary = output?.summary ?? "";
          await save(stage, "verify", sha);
          return;
        }

        if (stage === "verify") {
          let previousSignature: string | null = null;
          for (;;) {
            const { blamed: failures, notBlamed } = await verifyChecks(plan, stage, `verify-${data.repairs}`);
            if (failures.length === 0) {
              for (const name of notBlamed) {
                const note = `${name} fails at the base commit too; recorded, not blamed on this run`;
                if (!deviations.includes(note)) deviations.push(note);
              }
              break;
            }
            const signature = failures.map((f) => `${f.name}:${f.result.outputHash}`).sort().join("|");
            const regressed = data.baseline ? " (passed at baseline: a regression)" : "";
            if (signature === previousSignature) {
              await recorder.event({ kind: "repeated_failure", stage, data: { signature } });
              throw new RunStopped("failed", `the same checks failed identically after repair: ${failures.map((f) => f.name).join(", ")}${regressed}`);
            }
            if (data.repairs! >= contract.budgets.maxRepairPasses) {
              throw new RunStopped("failed", `mandatory checks still failing after ${data.repairs} repair pass(es): ${failures.map((f) => f.name).join(", ")}${regressed}`);
            }
            previousSignature = signature;
            data.repairs = data.repairs! + 1;
            await recorder.event({ kind: "repair_started", stage, data: { pass: data.repairs, failing: failures.map((f) => f.name) } });
            const failed = failures.map((f) => ({ name: f.name, exitCode: f.exitCode, timedOut: f.result.timedOut, output: f.result.output }));
            const { result } = await runAgent(stage, repairPrompt(failed, data.repairs, contract.budgets.maxRepairPasses), {
              role: "implementer",
              resume: true,
              schema: implementerOutputSchema,
            });
            throwIfStopped();
            if (!result.ok) throw new RunStopped("failed", `repair agent ended with ${result.reason}`);
            const sha = await checkpointCommit(worktree, `factory: repair pass ${data.repairs}`, undefined, setupPaths);
            if (!sha) throw new RunStopped("failed", `repair pass ${data.repairs} changed nothing`);
            await save(stage, "verify", sha);
          }
          if (!profile.independentReview && !data.escalation) await maybeEscalate(stage);
          stages = stagesOf(profile, data);
          await save(stage, stages[i + 1]!);
          return;
        }

        if (stage === "review") {
          await review(stage, plan);
          await save(stage, "deliver");
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

  /** A failing regression test, committed before any fix; or a recorded reason it can't exist. */
  async function reproduce(stage: Stage, plan: CheckPlan, nextStage: Stage) {
    const startSha = await headSha(worktree);
    const { result, output } = await runAgent(stage, reproducePrompt(contract, data.locate ?? null, plan), {
      role: "implementer",
      resume: false,
      schema: reproduceOutputSchema,
    });
    throwIfStopped();
    if (!result.ok) throw new RunStopped("failed", `implementer ended with ${result.reason} while reproducing`);
    if (!output) throw new RunStopped("failed", "the reproduce answer did not match its schema");
    for (const decision of output.decisions) decide(stage, decision);
    const touched = withoutSetup(await changedFiles(worktree, startSha));

    if (output.status === "not_reproducible") {
      if (!contract.spec.acceptanceCriteria.some((ac) => ac.verification === "manual")) {
        throw new RunStopped("failed", `the bug could not be reproduced by a test (${output.reason}) and every acceptance criterion requires automated verification`);
      }
      if (touched.length) await resetTo(worktree, startSha);
      decide(stage, `no regression test: ${output.reason}; continuing because the acceptance criteria allow manual verification`);
      data.reproduce = { status: "not_reproducible", reason: output.reason };
      await writeArtifact(repo, claimed.id, "reproduce.json", JSON.stringify(data.reproduce, null, 2));
      await save(stage, nextStage, startSha);
      return;
    }

    if (touched.length === 0) throw new RunStopped("failed", "the reproduce stage wrote no regression test");
    const nonTest = touched.filter((f) => !isTestPath(f));
    if (nonTest.length) {
      await recorder.event({ kind: "reproduce_rejected", stage, data: { nonTest } });
      throw new RunStopped("failed", `the reproduce stage may only add or change tests, but it changed ${nonTest.join(", ")}`);
    }
    const outcomes = await runChecks(plan, stage, "reproduce-checks");
    const failing = outcomes.filter((o) => !o.passed);
    if (failing.length === 0) {
      throw new RunStopped("failed", `the regression test (${touched.join(", ")}) passes before any fix, so it does not reproduce the bug`);
    }
    const sha = await checkpointCommit(worktree, `factory: reproduce ${contract.spec.title}`, undefined, setupPaths);
    if (!sha) throw new RunStopped("failed", "the regression test could not be committed");
    data.reproduce = { status: "reproduced", testFiles: touched, failing: failing.map(record) };
    await recorder.event({ kind: "bug_reproduced", stage, data: { testFiles: touched, failing: data.reproduce.failing } });
    await writeArtifact(repo, claimed.id, "reproduce.json", JSON.stringify(data.reproduce, null, 2));
    await save(stage, nextStage, sha);
  }

  /** Adds the review stage when a light run outgrew its estimate; stops when it outgrew its approval. */
  async function maybeEscalate(stage: Stage) {
    const { files } = await committedDiff(worktree, contract.baseSha, setupPaths);
    const assessed = assessEscalation(worktree, files, contract.spec.estimatedFiles);
    if (assessed.kind === "none") return;
    if (assessed.kind === "blocked") throw new RunStopped("failed", `escalation exceeds the approved scope: ${assessed.reason}`);
    const remainingMs = contract.budgets.wallClockMinutes * 60_000 - (Date.now() - startedAt);
    if (remainingMs < contract.budgets.wallClockMinutes * 60_000 * ESCALATION_BUDGET_SHARE) {
      throw new RunStopped("failed", `the run needs an independent review (${assessed.reason}) but too little of the wall-clock budget is left`);
    }
    data.escalation = { reason: assessed.reason };
    decide(stage, `escalated ${profile.name} to add an independent review: ${assessed.reason}`);
    await recorder.event({ kind: "profile_escalated", stage, data: { from: profile.name, added: ["review"], reason: assessed.reason, files: files.length } });
  }

  /** One review of the immutable diff; at most one repair pass and one recheck. */
  async function review(stage: Stage, plan: CheckPlan) {
    if (!data.review) {
      const { files, diff } = await committedDiff(worktree, contract.baseSha, setupPaths);
      const { result } = await runAgent(stage, reviewPrompt(contract, files, diff), { role: "reviewer", resume: false, schema: reviewOutputSchema });
      throwIfStopped();
      const validated = validateReview(result.structured, files, contract);
      if (!result.ok || !validated) throw new RunStopped("failed", "the independent review returned no valid verdict");
      data.review = validated;
      await writeArtifact(repo, claimed.id, "review.json", JSON.stringify(validated, null, 2));
      await recorder.event({ kind: "review_finished", stage, data: { verdict: validated.verdict, findings: validated.findings.length, blocking: validated.blocking.length, dropped: validated.dropped.length } });
      await save(stage, "review");
    }
    const { blocking } = data.review;
    if (blocking.length === 0) return;

    if (!data.reviewRepair) {
      await recorder.event({ kind: "review_repair_started", stage, data: { blocking: blocking.length } });
      const { result } = await runAgent(stage, reviewRepairPrompt(blocking), { role: "implementer", resume: true, schema: implementerOutputSchema });
      throwIfStopped();
      if (!result.ok) throw new RunStopped("failed", `review repair ended with ${result.reason}`);
      const sha = await checkpointCommit(worktree, "factory: review repair", undefined, setupPaths);
      if (!sha) throw new RunStopped("failed", `the review's blocking findings were not addressed: ${blocking.map((f) => `${f.file}: ${f.problem}`).join("; ")}`);
      data.reviewRepair = { sha };
      await save(stage, "review", sha);
    }
    const { blamed } = await verifyChecks(plan, stage, "verify-review-repair");
    if (blamed.length) {
      throw new RunStopped("failed", `checks failing after the review repair: ${blamed.map((f) => `${f.name} (exit ${f.exitCode}, output ${f.result.outputHash.slice(0, 12)})`).join(", ")}`);
    }
  }

  async function deliver() {
    const body = [
      contract.spec.objective,
      "",
      ...contract.spec.acceptanceCriteria.map((ac) => `- ${ac.id}: ${ac.text}`),
    ].join("\n");
    const prBody = data.refactors?.length ? [body, "", "## Suggested refactors (not applied)", ...renderRefactors(data.refactors)].join("\n") : body;
    const sha = await squashSince(worktree, contract.baseSha, `${contract.spec.title}\n\n${body}`);
    await recordEffect(database, { key: `branch:${claimed.id}`, runId: claimed.id, kind: "branch", result: { branch, sha } });
    const passed = verification.filter((v) => v.passed).length;
    const outcome: RunOutcome = {
      summary:
        passed === verification.length
          ? `Branch ${branch} at ${sha.slice(0, 12)}, all ${verification.length} checks passed.`
          : `Branch ${branch} at ${sha.slice(0, 12)}, ${passed} of ${verification.length} checks passed; the rest already failed at the base commit.`,
      branch,
      checks: verification.map((v) => ({ name: v.name, exitCode: v.exitCode, passed: v.passed })),
      ...(data.refactors?.length ? { refactors: data.refactors } : {}),
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
        : (await deps.openPullRequest({ repoPath: repo, branch, base: contract.baseBranch, title: contract.spec.title, body: prBody })).url;
      if (!existing) await recordEffect(database, { key: prKey, runId: claimed.id, kind: "pull_request", result: { url } });
      outcome.pullRequestUrl = url;
    } else if (deps.delivery === "pr") {
      deviations.push("PR delivery skipped: the approved contract does not permit push and PR, or no GitHub client is configured");
    }
    await saveProgress(database, claimed.id, { checkpoint: { stage: "deliver", sha, nextStage: "deliver", data: { ...data } as Record<string, unknown> } });
    return outcome;
  }
}

/** The profile-specific evidence task.md shows: brief, baseline, reproduction, escalation, review. */
function evidenceSections(data: RunData, verification: TaskView["verification"]): NonNullable<TaskView["sections"]> {
  const sections: NonNullable<TaskView["sections"]> = [];
  const passedNow = (name: string) => verification.find((v) => v.name === name)?.passed;
  if (data.architecture) {
    const brief = data.architecture;
    sections.push({
      heading: "Repository intelligence",
      lines: [
        `- Placement: ${brief.placement}`,
        ...brief.candidates.slice(0, 5).map((c) => `- Candidate: \`${c.path}\` (${c.importers} importer(s)${c.test ? `, tested by \`${c.test}\`` : ""})`),
        ...brief.risks.map((r) => `- Risk: ${r}`),
        "- Full brief: `artifacts/architecture.md`",
      ],
    });
  }
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
  if (data.refactors?.length) {
    sections.push({
      heading: "Suggested refactors",
      lines: [
        "Not applied. Each can start its own run.",
        ...data.refactors.flatMap((r) => [...renderRefactors([r]), `  - \`factory new "${refactorOutcome(r)}"\``]),
      ],
    });
  }
  if (data.escalation) sections.push({ heading: "Escalation", lines: [`- Added an independent review: ${data.escalation.reason}`] });
  if (data.review) {
    sections.push({
      heading: "Independent review",
      lines: [...renderReview(data.review), ...(data.reviewRepair ? [`- One repair pass made: \`${data.reviewRepair.sha.slice(0, 12)}\``] : [])],
    });
  }
  return sections;
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
