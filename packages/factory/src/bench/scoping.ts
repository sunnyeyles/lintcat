/** Scoping fixtures: a seeded repo and a draft spec; the scoper's verdict is graded against a hidden expectation. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { AgentRuntime } from "@pr-review/agent-runtime";
import { errorMessage } from "@pr-review/logging";
import { z } from "zod";

import type { LoadedBenchConfig } from "#src/bench/config";
import { buildRepo } from "#src/bench/fixtures";
import { resultDirName } from "#src/bench/runner";
import { categorySchema, specSchema, type Category, type Scoping, type Spec } from "#src/contract";
import { runScoper } from "#src/scoping";

const metaSchema = z.object({ description: z.string().min(1), baseSha: z.string().regex(/^[0-9a-f]{40}$/) });
const expectedSchema = z.object({
  /** Any of these is a correct verdict; the draft's own category means "accept". */
  categories: z.array(categorySchema).min(1),
  mustCite: z.array(z.string().min(1)),
});

export interface ScopingFixture {
  name: string;
  dir: string;
  description: string;
  baseSha: string;
  draft: Spec;
  expected: z.infer<typeof expectedSchema>;
}

export interface ScopingResult {
  schemaVersion: 1;
  config: { name: string; hash: string; model: string | null };
  fixture: { name: string; baseSha: string; draftCategory: Category; expected: Category[] };
  repetition: number;
  scoping: Omit<Scoping, "applied"> | null;
  /** The draft was mislabelled, so a correct verdict is a change. */
  shouldPushBack: boolean;
  pushedBack: boolean;
  categoryCorrect: boolean;
  missingCitations: string[];
  passed: boolean;
  error: string | null;
  estimatedCostUsd: number | null;
  startedAt: string;
  finishedAt: string;
}

const scopingRoot = (benchDir: string) => path.join(benchDir, "scoping");

export function listScopingFixtures(benchDir: string): string[] {
  const root = scopingRoot(benchDir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => existsSync(path.join(root, name, "fixture.json")))
    .sort();
}

export function loadScopingFixture(benchDir: string, name: string): ScopingFixture {
  const dir = path.join(scopingRoot(benchDir), name);
  const read = (file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as unknown;
  if (!existsSync(path.join(dir, "fixture.json"))) throw new Error(`no scoping fixture ${name} in ${benchDir}`);
  return { name, dir, ...metaSchema.parse(read("fixture.json")), draft: specSchema.parse(read("draft.json")), expected: expectedSchema.parse(read("expected.json")) };
}

/** Deterministic: the category must be one expected, and the evidence or reason must name every required file. */
export function gradeScoping(fixture: ScopingFixture, scoping: Omit<Scoping, "applied">) {
  const shouldPushBack = !fixture.expected.categories.includes(fixture.draft.category);
  const pushedBack = scoping.verdict === "change";
  const categoryCorrect = fixture.expected.categories.includes(scoping.proposed);
  const cited = [...scoping.evidence, scoping.reason].join("\n");
  const missingCitations = pushedBack ? fixture.expected.mustCite.filter((file) => !cited.includes(file)) : [];
  return { shouldPushBack, pushedBack, categoryCorrect, missingCitations, passed: categoryCorrect && missingCitations.length === 0 };
}

export interface ScopingBenchOptions {
  runtime: AgentRuntime;
  benchDir: string;
  config: LoadedBenchConfig;
  fixtures?: string[];
  resultsDir?: string;
  workDir?: string;
  onResult?: (result: ScopingResult) => void;
}

export async function runScopingBenchmark(options: ScopingBenchOptions): Promise<ScopingResult[]> {
  const { config, hash } = options.config;
  const runtime: AgentRuntime = config.model
    ? { name: options.runtime.name, run: (spec) => options.runtime.run({ ...spec, model: config.model }) }
    : options.runtime;
  const names = options.fixtures ?? listScopingFixtures(options.benchDir);
  const resultsDir = path.join(options.resultsDir ?? path.join(options.benchDir, "results", "scoping"), resultDirName(options.config));
  mkdirSync(resultsDir, { recursive: true });
  const results: ScopingResult[] = [];
  for (const fixture of names.map((name) => loadScopingFixture(options.benchDir, name))) {
    for (let repetition = 1; repetition <= config.repeat; repetition++) {
      const startedAt = new Date().toISOString();
      const workDir = mkdtempSync(path.join(options.workDir ?? tmpdir(), `factory-scoping-${fixture.name}-`));
      const base = {
        schemaVersion: 1 as const,
        config: { name: config.name, hash, model: config.model ?? null },
        fixture: { name: fixture.name, baseSha: fixture.baseSha, draftCategory: fixture.draft.category, expected: fixture.expected.categories },
        repetition,
        startedAt,
      };
      let result: ScopingResult;
      try {
        const { repoPath } = await buildRepo(fixture, path.join(workDir, "repo"));
        const { scoping, usage } = await runScoper({ runtime, repoPath, spec: fixture.draft });
        result = { ...base, scoping, ...gradeScoping(fixture, scoping), error: null, estimatedCostUsd: usage.estimatedCostUsd, finishedAt: new Date().toISOString() };
      } catch (error) {
        const shouldPushBack = !fixture.expected.categories.includes(fixture.draft.category);
        result = {
          ...base,
          scoping: null,
          shouldPushBack,
          pushedBack: false,
          categoryCorrect: false,
          missingCitations: [],
          passed: false,
          error: errorMessage(error),
          estimatedCostUsd: null,
          finishedAt: new Date().toISOString(),
        };
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
      writeFileSync(path.join(resultsDir, `${startedAt.replace(/[:.]/g, "-")}-${fixture.name}-${repetition}.json`), `${JSON.stringify(result, null, 2)}\n`);
      results.push(result);
      options.onResult?.(result);
    }
  }
  return results;
}

/** Right pushbacks on mislabelled drafts and wrong ones on correct drafts, counted apart. */
export function summarizeScoping(results: readonly ScopingResult[]) {
  const mislabelled = results.filter((r) => r.shouldPushBack);
  const correct = results.filter((r) => !r.shouldPushBack);
  return {
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    rightPushbacks: mislabelled.filter((r) => r.passed).length,
    mislabelled: mislabelled.length,
    falsePushbacks: correct.filter((r) => r.pushedBack).length,
    correctlyLabelled: correct.length,
  };
}
