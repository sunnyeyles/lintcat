/** One function per workflow stage; each reads and advances the run's state and checkpoint. */
import { existsSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { CheckPlan } from "#src/engine/checks";
import { changedFiles, checkpointCommit, committedDiff, createWorktree, dirtyPaths, headSha, isClean, pushBranch, resetTo, squashSince } from "#src/engine/git";
import { locate } from "#src/engine/locate";
import type { Stage } from "#src/engine/profiles";
import { isTestPath } from "#src/engine/repository";
import { reviewOutputSchema, reviewPrompt, reviewRepairPrompt, validateReview } from "#src/engine/review";
import { errorCategory, record, RunStopped, type ActiveRun } from "#src/engine/run-context";
import { writeArtifact } from "#src/engine/run-files";
import { DEFAULT_LIMITS, SANDBOX_IMAGE } from "#src/engine/sandbox/sandbox";
import { implementPrompt, repairPrompt, reproducePrompt } from "#src/engine/stage-prompts";
import { findEffect, recordEffect, saveProgress, type RunOutcome } from "#src/engine/store/index";

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

const reproduceOutputSchema = z.object({
  status: z.enum(["reproduced", "not_reproducible"]),
  summary: z.string(),
  reason: z.string(),
  decisions: z.array(z.string()),
});

type StageStep = (run: ActiveRun, plan: CheckPlan, nextStage: Stage) => Promise<RunOutcome | void>;

/** Always reruns on recovery: the sandbox is disposable and the worktree must match the checkpoint. */
export async function prepare(run: ActiveRun, plan: CheckPlan) {
  const { deps, claimed, contract, worktree, branch, recorder } = run;
  run.mark("prepare", "running");
  await saveProgress(deps.database, claimed.id, { stage: "prepare", branch, worktreePath: worktree });
  const { created } = await createWorktree(run.repo, { path: worktree, branch, baseSha: contract.baseSha });
  const target = run.checkpoint?.sha ?? contract.baseSha;
  if (!created && ((await headSha(worktree)) !== target || !(await isClean(worktree)))) {
    await resetTo(worktree, target);
    await recorder.event({ kind: "worktree_reconciled", stage: "prepare", repositorySha: target });
  }
  const sandbox = await deps.sandboxes.create({ runId: claimed.id, worktreePath: worktree, image: SANDBOX_IMAGE, limits: DEFAULT_LIMITS });
  run.sandbox = sandbox;
  if (plan.install) {
    const startedAt = new Date();
    const result = await sandbox.setup({ command: plan.install, timeoutMs: contract.budgets.commandTimeoutSeconds * 1000 });
    await recorder.command({ stage: "prepare", name: "install", command: plan.install, cwd: "/workspace", startedAt, durationMs: result.durationMs, exitCode: result.exitCode, timedOut: result.timedOut, errorCategory: errorCategory(result), outputHash: result.outputHash, output: result.output });
    if (result.exitCode !== 0) throw new RunStopped("failed", `dependency install failed (exit ${result.exitCode})`);
  }
  await sandbox.isolate();
  // Install output (lockfiles, node_modules in a repo that doesn't ignore it) is not the agent's change.
  run.setupPaths = await dirtyPaths(worktree);
  if (run.setupPaths.length > 0) {
    run.deviations.push(`left out of the delivery, written by dependency install: ${run.setupPaths.join(", ")}`);
    await recorder.event({ kind: "setup_paths_excluded", stage: "prepare", data: { paths: run.setupPaths } });
  }
  await recorder.event({ kind: "sandbox_ready", stage: "prepare", data: { sandbox: deps.sandboxes.name, image: SANDBOX_IMAGE, limits: DEFAULT_LIMITS, network: "none" } });
  run.mark("prepare", "done");
}

async function locateStage(run: ActiveRun, _plan: CheckPlan, nextStage: Stage) {
  const located = await locate(run.worktree, run.contract.spec);
  run.data.locate = located;
  await writeArtifact(run.repo, run.claimed.id, "locate.json", JSON.stringify(located, null, 2));
  await run.save("locate", nextStage);
}

async function baseline(run: ActiveRun, plan: CheckPlan, nextStage: Stage) {
  const outcomes = await run.runChecks(plan, "baseline", "baseline");
  run.data.baseline = outcomes.map(record);
  await run.recorder.event({ kind: "baseline_recorded", stage: "baseline", data: { results: run.data.baseline } });
  if (!outcomes.some((o) => o.passed)) {
    throw new RunStopped("failed", "no check passes at the base commit, so the refactor could not be shown to preserve behaviour");
  }
  await run.save("baseline", nextStage);
}

/** A failing regression test, committed before any fix; or a recorded reason it can't exist. */
async function reproduce(run: ActiveRun, plan: CheckPlan, nextStage: Stage) {
  const stage = "reproduce";
  const { worktree, data } = run;
  const startSha = await headSha(worktree);
  const { result, output } = await run.runAgent(stage, reproducePrompt(run.contract, data.locate ?? null, plan), {
    role: "implementer",
    resume: false,
    schema: reproduceOutputSchema,
  });
  run.throwIfStopped();
  if (!result.ok) throw new RunStopped("failed", `implementer ended with ${result.reason} while reproducing`);
  if (!output) throw new RunStopped("failed", "the reproduce answer did not match its schema");
  for (const decision of output.decisions) run.decide(stage, decision);
  const touched = run.withoutSetup(await changedFiles(worktree, startSha));

  if (output.status === "not_reproducible") {
    if (!run.contract.spec.acceptanceCriteria.some((ac) => ac.verification === "manual")) {
      throw new RunStopped("failed", `the bug could not be reproduced by a test (${output.reason}) and every acceptance criterion requires automated verification`);
    }
    if (touched.length) await resetTo(worktree, startSha);
    run.decide(stage, `no regression test: ${output.reason}; continuing because the acceptance criteria allow manual verification`);
    data.reproduce = { status: "not_reproducible", reason: output.reason };
    await writeArtifact(run.repo, run.claimed.id, "reproduce.json", JSON.stringify(data.reproduce, null, 2));
    await run.save(stage, nextStage, startSha);
    return;
  }

  if (touched.length === 0) throw new RunStopped("failed", "the reproduce stage wrote no regression test");
  const nonTest = touched.filter((f) => !isTestPath(f));
  if (nonTest.length) {
    await run.recorder.event({ kind: "reproduce_rejected", stage, data: { nonTest } });
    throw new RunStopped("failed", `the reproduce stage may only add or change tests, but it changed ${nonTest.join(", ")}`);
  }
  const outcomes = await run.runChecks(plan, stage, "reproduce-checks");
  const failing = outcomes.filter((o) => !o.passed);
  if (failing.length === 0) {
    throw new RunStopped("failed", `the regression test (${touched.join(", ")}) passes before any fix, so it does not reproduce the bug`);
  }
  const sha = await checkpointCommit(worktree, `factory: reproduce ${run.contract.spec.title}`, run.setupPaths);
  if (!sha) throw new RunStopped("failed", "the regression test could not be committed");
  data.reproduce = { status: "reproduced", testFiles: touched, failing: failing.map(record) };
  await run.recorder.event({ kind: "bug_reproduced", stage, data: { testFiles: touched, failing: data.reproduce.failing } });
  await writeArtifact(run.repo, run.claimed.id, "reproduce.json", JSON.stringify(data.reproduce, null, 2));
  await run.save(stage, nextStage, sha);
}

async function implement(run: ActiveRun, plan: CheckPlan) {
  const stage = "implement";
  const { worktree, data, deviations } = run;
  const needsPlacement = run.profile.name === "feature" || run.profile.name === "refactor";
  const reproduced = data.reproduce?.status === "reproduced" ? data.reproduce : undefined;
  const prompt = implementPrompt(
    run.contract,
    {
      located: data.locate ?? null,
      regression: reproduced ? { testFiles: reproduced.testFiles, failing: reproduced.failing.map((f) => f.name) } : undefined,
      baselineFailing: data.baseline?.filter((b) => !b.passed).map((b) => b.name),
      placement: needsPlacement,
    },
    plan,
  );
  const schema = needsPlacement ? placedOutputSchema : implementerOutputSchema;
  const { result, output } = await run.runAgent(stage, prompt, { role: "implementer", resume: reproduced !== undefined, schema });
  run.throwIfStopped();
  if (!result.ok) throw new RunStopped("failed", `implementer ended with ${result.reason}`);
  if (output) {
    for (const decision of output.decisions) run.decide(stage, decision);
    if ("placement" in output) {
      const { location, reuse, rationale } = output.placement as z.infer<typeof placedOutputSchema>["placement"];
      run.decide(stage, `placement: ${location} (${rationale})`);
      run.decide(stage, `reuse: ${reuse.length ? reuse.join(", ") : "no existing module reused"}`);
    }
    await saveProgress(run.deps.database, run.claimed.id, { contract: run.contract });
    if (output.status === "blocked") throw new RunStopped("failed", `implementer blocked: ${output.blockers.join("; ") || output.summary}`);
    if (output.status === "partial") deviations.push(`implementer reported partial: ${output.summary}`);
  } else {
    deviations.push(
      needsPlacement
        ? "implementer's final answer did not match its schema, so no placement or reuse justification was recorded"
        : "implementer's final answer did not match its schema",
    );
  }
  const sha = await checkpointCommit(worktree, `factory: implement ${run.contract.spec.title}`, run.setupPaths);
  if (!sha) throw new RunStopped("failed", "the implementer made no changes");
  const missing = (reproduced?.testFiles ?? []).filter((f) => !existsSync(path.join(worktree, f)));
  if (missing.length) throw new RunStopped("failed", `the fix deleted the regression test: ${missing.join(", ")}`);
  data.summary = output?.summary ?? "";
  await run.save(stage, "verify", sha);
}

async function verify(run: ActiveRun, plan: CheckPlan, nextStage: Stage) {
  const stage = "verify";
  const { data, deviations, contract } = run;
  let previousSignature: string | null = null;
  for (;;) {
    const { blamed: failures, notBlamed } = await run.verifyChecks(plan, stage, `verify-${data.repairs}`);
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
      await run.recorder.event({ kind: "repeated_failure", stage, data: { signature } });
      throw new RunStopped("failed", `the same checks failed identically after repair: ${failures.map((f) => f.name).join(", ")}${regressed}`);
    }
    if (data.repairs! >= contract.budgets.maxRepairPasses) {
      throw new RunStopped("failed", `mandatory checks still failing after ${data.repairs} repair pass(es): ${failures.map((f) => f.name).join(", ")}${regressed}`);
    }
    previousSignature = signature;
    data.repairs = data.repairs! + 1;
    await run.recorder.event({ kind: "repair_started", stage, data: { pass: data.repairs, failing: failures.map((f) => f.name) } });
    const failed = failures.map((f) => ({ name: f.name, exitCode: f.exitCode, timedOut: f.result.timedOut, output: f.result.output }));
    const { result } = await run.runAgent(stage, repairPrompt(failed, data.repairs, contract.budgets.maxRepairPasses), {
      role: "implementer",
      resume: true,
      schema: implementerOutputSchema,
    });
    run.throwIfStopped();
    if (!result.ok) throw new RunStopped("failed", `repair agent ended with ${result.reason}`);
    const sha = await checkpointCommit(run.worktree, `factory: repair pass ${data.repairs}`, run.setupPaths);
    if (!sha) throw new RunStopped("failed", `repair pass ${data.repairs} changed nothing`);
    await run.save(stage, "verify", sha);
  }
  await run.save(stage, nextStage);
}

/** One review of the immutable diff; at most one repair pass and one recheck. */
async function review(run: ActiveRun, plan: CheckPlan) {
  const stage = "review";
  const { worktree, data } = run;
  if (!data.review) {
    const { files, diff } = await committedDiff(worktree, run.contract.baseSha, run.setupPaths);
    const { result } = await run.runAgent(stage, reviewPrompt(run.contract, files, diff), { role: "reviewer", resume: false, schema: reviewOutputSchema });
    run.throwIfStopped();
    const validated = validateReview(result.structured, files, run.contract);
    if (!result.ok || !validated) throw new RunStopped("failed", "the independent review returned no valid verdict");
    data.review = validated;
    await writeArtifact(run.repo, run.claimed.id, "review.json", JSON.stringify(validated, null, 2));
    await run.recorder.event({ kind: "review_finished", stage, data: { verdict: validated.verdict, findings: validated.findings.length, blocking: validated.blocking.length, dropped: validated.dropped.length } });
    await run.save(stage, "review");
  }
  const { blocking } = data.review;
  if (blocking.length > 0) {
    if (!data.reviewRepair) {
      await run.recorder.event({ kind: "review_repair_started", stage, data: { blocking: blocking.length } });
      const { result } = await run.runAgent(stage, reviewRepairPrompt(blocking), { role: "implementer", resume: true, schema: implementerOutputSchema });
      run.throwIfStopped();
      if (!result.ok) throw new RunStopped("failed", `review repair ended with ${result.reason}`);
      const sha = await checkpointCommit(worktree, "factory: review repair", run.setupPaths);
      if (!sha) throw new RunStopped("failed", `the review's blocking findings were not addressed: ${blocking.map((f) => `${f.file}: ${f.problem}`).join("; ")}`);
      data.reviewRepair = { sha };
      await run.save(stage, "review", sha);
    }
    const { blamed } = await run.verifyChecks(plan, stage, "verify-review-repair");
    if (blamed.length) {
      throw new RunStopped("failed", `checks failing after the review repair: ${blamed.map((f) => `${f.name} (exit ${f.exitCode}, output ${f.result.outputHash.slice(0, 12)})`).join(", ")}`);
    }
  }
  await run.save(stage, "deliver");
}

async function deliver(run: ActiveRun): Promise<RunOutcome> {
  const { deps, claimed, contract, worktree, branch, verification } = run;
  const { database } = deps;
  const body = [
    contract.spec.objective,
    "",
    ...contract.spec.acceptanceCriteria.map((ac) => `- ${ac.id}: ${ac.text}`),
  ].join("\n");
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
      : (await deps.openPullRequest({ repoPath: run.repo, branch, base: contract.baseBranch, title: contract.spec.title, body })).url;
    if (!existing) await recordEffect(database, { key: prKey, runId: claimed.id, kind: "pull_request", result: { url } });
    outcome.pullRequestUrl = url;
  } else if (deps.delivery === "pr") {
    run.deviations.push("PR delivery skipped: the approved contract does not permit push and PR, or no GitHub client is configured");
  }
  await saveProgress(database, claimed.id, { checkpoint: { stage: "deliver", sha, nextStage: "deliver", data: { ...run.data } as Record<string, unknown> } });
  return outcome;
}

/** The stages after prepare; a stage missing here fails the run as not implemented. */
export const STAGE_STEPS: Partial<Record<Stage, StageStep>> = {
  locate: locateStage,
  baseline,
  reproduce,
  implement,
  verify,
  review,
  deliver,
};
