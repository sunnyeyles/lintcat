import { mkdirSync, rmSync } from "node:fs";

import type { DebtConfig } from "#src/config";
import type { Graph } from "#src/graph";
import { overallMetrics } from "#src/metrics/overall";
import { bundleBytes, deadCode, depCounts, lint, typecheck } from "#src/metrics/static";
import { readTestResults, runVitest } from "#src/metrics/tests";
import type { OverallMetrics, PackageMetrics } from "#src/snapshot";
import type { Workspace } from "#src/workspaces";

export type Step = "tests" | "typecheck" | "lint" | "dead-code" | "network";

export interface CollectOptions {
  root: string;
  outDir: string;
  config: DebtConfig;
  graph: Graph;
  workspaces: Workspace[];
  packages: string[];
  skip: Set<Step>;
  log: (line: string) => void;
}

export interface Collected {
  packages: Record<string, PackageMetrics>;
  overall: OverallMetrics;
}

export function collectMetrics(options: CollectOptions): Collected {
  const { root, outDir, config, graph, workspaces, packages, skip, log } = options;
  const selected = workspaces.filter((w) => packages.includes(w.name));
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  let tests: ReturnType<typeof readTestResults> = {};
  if (!skip.has("tests")) {
    log(`vitest: ${selected.length === workspaces.length ? "all projects" : selected.map((w) => w.name).join(", ")}`);
    const projects = selected.length === workspaces.length ? [] : selected.map((w) => w.name);
    const result = runVitest(root, outDir, projects);
    if (!result.ok) log("vitest reported failures; counts recorded as they are");
    tests = readTestResults(root, outDir, graph);
  }

  const dead = skip.has("dead-code") ? null : (log("knip"), deadCode(root, graph));

  const out: Record<string, PackageMetrics> = {};
  for (const w of selected) {
    log(`static checks: ${w.name}`);
    out[w.name] = {
      tests: tests[w.name]?.tests ?? null,
      coverage: tests[w.name]?.coverage ?? null,
      typecheck: skip.has("typecheck") ? null : typecheck(root, w),
      lint: skip.has("lint") ? null : lint(root, w),
      deadCode: dead?.[w.name] ?? null,
      deps: depCounts(w),
      bundleBytes: bundleBytes(root, config.metrics.bundles[w.name]),
    };
  }
  log(skip.has("network") ? "registry checks skipped" : "registry checks: pnpm audit, pnpm outdated");
  const overall = overallMetrics(root, !skip.has("network"));
  return { packages: out, overall };
}
