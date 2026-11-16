/** The deterministic orchestrator: agents reason, this code owns state, checks and delivery. */
import type { AgentRuntime } from "#src/agent/runtime";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { detectChecks } from "#src/engine/checks";
import { assertFrozen } from "#src/engine/contract";
import type { Stage } from "#src/engine/profiles";
import { ActiveRun, RunStopped, usageTotals } from "#src/engine/run-context";
import type { SandboxProvider } from "#src/engine/sandbox/sandbox";
import { prepare, STAGE_STEPS } from "#src/engine/stages";
import { noteRecovery, saveProgress, settleRun, type FactoryDatabase, type FactoryRun, type RunOutcome } from "#src/engine/store/index";

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
}

/** Runs one claimed run to a terminal state; never throws for run-level failures. */
export async function executeRun(deps: EngineDeps, claimed: FactoryRun): Promise<FactoryRun["status"]> {
  const { database, logger } = deps;
  const run = new ActiveRun(deps, claimed);
  const { profile, recorder, branch } = run;

  try {
    assertFrozen(run.contract);

    const recovering = run.checkpoint !== null || claimed.attempts > 1;
    if (recovering) {
      const recoveries = await noteRecovery(database, claimed.id);
      await recorder.event({ kind: "recovery_started", data: { recoveries, checkpoint: run.checkpoint } });
      if (recoveries > MAX_RECOVERIES) throw new RunStopped("failed", `gave up after ${MAX_RECOVERIES} recoveries`);
    }
    await recorder.event({ kind: "run_started", data: { attempt: claimed.attempts, profile: profile.name, branch } });

    const plan = await detectChecks(run.repo);
    if (plan.checks.length === 0) {
      throw new RunStopped("failed", "no checks detected: add .factory/checks so the change can be verified");
    }
    const { stages } = profile;
    const startIndex = run.checkpoint ? stages.indexOf(run.checkpoint.nextStage as Stage) : 0;
    if (startIndex < 0) throw new RunStopped("failed", `checkpoint names unknown stage ${run.checkpoint?.nextStage}`);
    for (const stage of stages.slice(0, startIndex)) run.mark(stage, "done", "before recovery");

    run.currentStage = "prepare";
    await recorder.stage("prepare", () => prepare(run, plan));
    await run.sync();

    let delivered: RunOutcome | undefined;
    run.data.repairs ??= 0;

    for (let i = Math.max(startIndex, 1); i < stages.length; i++) {
      const stage = stages[i]!;
      run.throwIfStopped();
      run.currentStage = stage;
      run.mark(stage, "running");
      await saveProgress(database, claimed.id, { stage, ...(stage === "verify" ? { status: "verifying" } : {}) });
      if (stage === "verify") run.status = "verifying";
      await run.sync();

      await recorder.stage(stage, async () => {
        const step = STAGE_STEPS[stage];
        if (!step) throw new RunStopped("failed", `stage ${stage} is not implemented in this version`);
        const outcome = await step(run, plan, stages[i + 1]!);
        if (stage === "deliver") delivered = outcome ?? undefined;
      });
      run.mark(stage, "done");
    }

    run.status = "delivered";
    const outcome: RunOutcome = { ...(delivered ?? { summary: "delivered", branch }), usage: usageTotals(run.usage) };
    await settleRun(database, claimed.id, { status: "delivered", outcome });
    await recorder.event({ kind: "run_delivered", data: { branch, pullRequestUrl: outcome.pullRequestUrl ?? null } });
    await run.sync({ summary: outcome.summary, branch, ...(outcome.pullRequestUrl ? { pullRequestUrl: outcome.pullRequestUrl } : {}) });
    return run.status;
  } catch (error) {
    const stopped = run.stoppedBy(error);
    run.status = stopped?.status ?? "failed";
    const { status, currentStage, verification } = run;
    const blocker = stopped?.blocker ?? `unexpected error: ${errorMessage(error)}`;
    if (currentStage) run.mark(currentStage, "failed", blocker);
    await settleRun(database, claimed.id, {
      status,
      blocker,
      outcome: { summary: blocker, branch, checks: verification.map((v) => ({ name: v.name, exitCode: v.exitCode, passed: v.passed })), usage: usageTotals(run.usage) },
    }).catch((settleError: unknown) => logger.error("settle failed", { error: errorMessage(settleError) }));
    await recorder.event({ kind: status === "cancelled" ? "run_cancelled" : "run_failed", ...(currentStage ? { stage: currentStage } : {}), data: { blocker } }).catch(() => {});
    await run.sync({ summary: blocker, branch }, [blocker]).catch(() => {});
    return status;
  } finally {
    await run.close();
  }
}
