/** Runs fixtures through the factory's public service, then judges each result with hidden checks. */
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { AgentRuntime } from "@pr-review/agent-runtime";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import type { LoadedBenchConfig } from "#src/bench/config";
import { buildFixture, listFixtures, loadFixture, type Fixture } from "#src/bench/fixtures";
import { DEFAULT_LIMITS, SANDBOX_IMAGE, type SandboxProvider } from "#src/sandbox/index";
import { createFactoryService } from "#src/service";
import type { FactoryDatabase } from "#src/store/client";
import { updateDraft } from "#src/store/runs";
import { TOOL_VERSION } from "#src/telemetry";

const run = promisify(execFile);

const HIDDEN_DIR = ".bench-hidden";
const HIDDEN_COMMAND = `node --test "${HIDDEN_DIR}/*.test.mjs"`;
const HIDDEN_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 4_000;

export interface HiddenCheckResult {
  ran: boolean;
  passed: boolean;
  exitCode: number | null;
  output: string;
}

export interface BenchResult {
  schemaVersion: 1;
  config: { name: string; hash: string; model: string | null };
  fixture: { name: string; baseSha: string };
  repetition: number;
  runId: string | null;
  profile: string | null;
  workflowVersion: string | null;
  promptVersions: string[];
  toolVersion: string;
  factoryStatus: string;
  blocker: string | null;
  /** What the factory said about its own checks: kept to measure, never to decide. */
  claimedChecksPassed: boolean;
  hidden: HiddenCheckResult;
  verified: boolean;
  repairs: number;
  wallTimeMs: number | null;
  estimatedCostUsd: number | null;
  startedAt: string;
  finishedAt: string;
}

export interface BenchDeps {
  database: FactoryDatabase;
  runtime: AgentRuntime;
  sandboxes: SandboxProvider;
  /** Where hidden checks run; defaults to `sandboxes`, so delivered code never runs on the host. */
  hiddenSandboxes?: SandboxProvider;
  logger: StructuredLogger;
  sandboxImage?: string;
  heartbeatMs?: number;
}

export interface BenchOptions {
  benchDir: string;
  config: LoadedBenchConfig;
  fixtures?: string[];
  resultsDir?: string;
  workDir?: string;
  keepWorkDirs?: boolean;
  onResult?: (result: BenchResult) => void;
}

const bounded = (text: string) => (text.length > OUTPUT_LIMIT ? `…${text.slice(-OUTPUT_LIMIT)}` : text);

function withModel(runtime: AgentRuntime, model: string | undefined): AgentRuntime {
  if (!model) return runtime;
  return { name: runtime.name, run: (spec) => runtime.run({ ...spec, model }) };
}

/** Clones the delivered branch fresh, adds the hidden tests and runs them offline in a sandbox. */
export async function runHiddenChecks(input: {
  repoPath: string;
  branch: string;
  fixture: Fixture;
  sandboxes: SandboxProvider;
  image: string;
  label: string;
  workDir: string;
}): Promise<HiddenCheckResult> {
  const clone = mkdtempSync(path.join(input.workDir, "hidden-"));
  try {
    await run("git", ["clone", "-q", "--no-local", "--branch", input.branch, input.repoPath, clone]);
    try {
      await run("git", ["-C", clone, "merge-base", "--is-ancestor", input.fixture.baseSha, "HEAD"]);
    } catch {
      return { ran: false, passed: false, exitCode: null, output: `branch ${input.branch} does not descend from the fixture's base` };
    }
    cpSync(input.fixture.hiddenDir, path.join(clone, HIDDEN_DIR), { recursive: true });
    const sandbox = await input.sandboxes.create({ runId: input.label, worktreePath: clone, image: input.image, limits: DEFAULT_LIMITS });
    try {
      await sandbox.isolate();
      const result = await sandbox.exec({ command: HIDDEN_COMMAND, timeoutMs: HIDDEN_TIMEOUT_MS });
      return { ran: true, passed: result.exitCode === 0 && !result.timedOut, exitCode: result.exitCode, output: bounded(result.output) };
    } finally {
      await sandbox.destroy().catch(() => {});
    }
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

export function resultDirName(config: LoadedBenchConfig): string {
  return `${config.config.name}-${config.hash.slice(0, 8)}`;
}

async function runFixture(deps: BenchDeps, options: BenchOptions, fixture: Fixture, repetition: number, workDir: string): Promise<BenchResult> {
  const { config, hash } = options.config;
  const startedAt = new Date();
  const base = {
    schemaVersion: 1 as const,
    config: { name: config.name, hash, model: config.model ?? null },
    fixture: { name: fixture.name, baseSha: fixture.baseSha },
    repetition,
    toolVersion: TOOL_VERSION,
    startedAt: startedAt.toISOString(),
  };
  const notRun: HiddenCheckResult = { ran: false, passed: false, exitCode: null, output: "" };
  const service = createFactoryService({
    database: deps.database,
    runtime: withModel(deps.runtime, config.model),
    sandboxes: deps.sandboxes,
    logger: deps.logger,
    ...(deps.sandboxImage ? { sandboxImage: deps.sandboxImage } : {}),
    ...(deps.heartbeatMs ? { heartbeatMs: deps.heartbeatMs } : {}),
  });
  const { repoPath } = await buildFixture(fixture, path.join(workDir, "repo"));
  const { run: proposed } = await service.propose({
    repoPath,
    spec: fixture.spec,
    promptVersion: `bench:${config.name}`,
    ...(config.profileOverride ? { profileOverride: config.profileOverride } : {}),
  });
  if (config.budgets) {
    const contract = { ...proposed.contract, budgets: { ...proposed.contract.budgets, ...config.budgets } };
    await updateDraft(deps.database, proposed.id, { contract, title: proposed.title, status: "awaiting_approval", profile: contract.profile });
  }
  try {
    await service.approve(proposed.id);
  } catch (error) {
    return {
      ...base,
      runId: proposed.id,
      profile: proposed.profile,
      workflowVersion: null,
      promptVersions: [],
      factoryStatus: "blocked",
      blocker: errorMessage(error),
      claimedChecksPassed: false,
      hidden: notRun,
      verified: false,
      repairs: 0,
      wallTimeMs: null,
      estimatedCostUsd: null,
      finishedAt: new Date().toISOString(),
    };
  }
  await service.runNext({ runId: proposed.id });
  const finished = (await service.get(proposed.id))!;
  const events = await service.events(proposed.id);
  const started = events.find((e) => e.kind === "run_started")?.at;
  const checks = finished.outcome?.checks ?? [];
  const hidden =
    finished.status === "delivered" && finished.branch
      ? await runHiddenChecks({
          repoPath,
          branch: finished.branch,
          fixture,
          sandboxes: deps.hiddenSandboxes ?? deps.sandboxes,
          image: deps.sandboxImage ?? SANDBOX_IMAGE,
          label: `bench-${proposed.id}`,
          workDir,
        })
      : notRun;
  const cost = finished.outcome?.usage?.estimatedCostUsd;
  return {
    ...base,
    runId: finished.id,
    profile: finished.profile,
    workflowVersion: finished.workflowVersion,
    promptVersions: [...new Set(events.map((e) => e.promptVersion).filter((v): v is string => !!v))].sort(),
    factoryStatus: finished.status,
    blocker: finished.blocker,
    claimedChecksPassed: checks.length > 0 && checks.every((c) => c.passed),
    hidden,
    verified: finished.status === "delivered" && hidden.passed,
    repairs: events.filter((e) => e.kind === "repair_started").length,
    wallTimeMs: started && finished.finishedAt ? finished.finishedAt.getTime() - started.getTime() : null,
    estimatedCostUsd: typeof cost === "number" ? cost : null,
    finishedAt: new Date().toISOString(),
  };
}

/** One result per fixture and repetition; a fixture that throws is recorded, never fatal. */
export async function runBenchmark(deps: BenchDeps, options: BenchOptions): Promise<BenchResult[]> {
  const { config } = options.config;
  const names = options.fixtures ?? config.fixtures ?? listFixtures(options.benchDir);
  const fixtures = names.map((name) => loadFixture(options.benchDir, name));
  const root = options.workDir ?? tmpdir();
  const resultsDir = path.join(options.resultsDir ?? path.join(options.benchDir, "results"), resultDirName(options.config));
  mkdirSync(resultsDir, { recursive: true });
  const results: BenchResult[] = [];
  for (const fixture of fixtures) {
    for (let repetition = 1; repetition <= config.repeat; repetition++) {
      const workDir = mkdtempSync(path.join(root, `factory-bench-${fixture.name}-`));
      let result: BenchResult;
      try {
        result = await runFixture(deps, options, fixture, repetition, workDir);
      } catch (error) {
        const at = new Date().toISOString();
        result = {
          schemaVersion: 1,
          config: { name: config.name, hash: options.config.hash, model: config.model ?? null },
          fixture: { name: fixture.name, baseSha: fixture.baseSha },
          repetition,
          runId: null,
          profile: null,
          workflowVersion: null,
          promptVersions: [],
          toolVersion: TOOL_VERSION,
          factoryStatus: "harness_error",
          blocker: errorMessage(error),
          claimedChecksPassed: false,
          hidden: { ran: false, passed: false, exitCode: null, output: "" },
          verified: false,
          repairs: 0,
          wallTimeMs: null,
          estimatedCostUsd: null,
          startedAt: at,
          finishedAt: at,
        };
      } finally {
        if (!options.keepWorkDirs) rmSync(workDir, { recursive: true, force: true });
      }
      const file = path.join(resultsDir, `${result.startedAt.replace(/[:.]/g, "-")}-${fixture.name}-${repetition}.json`);
      writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
      results.push(result);
      options.onResult?.(result);
    }
  }
  return results;
}

/** Every result JSON under a directory, oldest first. */
export function loadResults(dir: string): BenchResult[] {
  if (!existsSync(dir)) throw new Error(`no results at ${dir}`);
  const walk = (current: string): string[] =>
    readdirSync(current).flatMap((entry) => {
      const full = path.join(current, entry);
      return statSync(full).isDirectory() ? walk(full) : entry.endsWith(".json") ? [full] : [];
    });
  return walk(dir)
    .map((file) => JSON.parse(readFileSync(file, "utf8")) as BenchResult)
    .filter((result) => result.schemaVersion === 1)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
