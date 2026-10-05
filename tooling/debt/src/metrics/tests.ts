import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Graph } from "#src/graph";
import { packageForFile } from "#src/graph";
import { bin, parseJson, run } from "#src/run";
import type { Coverage, PackageMetrics } from "#src/snapshot";

interface VitestJson {
  testResults: Array<{ name: string; assertionResults: Array<{ status: string }> }>;
}

interface SummaryEntry {
  lines: { total: number; covered: number };
  statements: { total: number; covered: number };
  branches: { total: number; covered: number };
  functions: { total: number; covered: number };
}

type TestsAndCoverage = Pick<PackageMetrics, "tests" | "coverage">;

export function runVitest(root: string, outDir: string, projects: string[]): { ok: boolean; log: string } {
  const args = [
    "run",
    "--coverage",
    "--coverage.reporter=json-summary",
    `--coverage.reportsDirectory=${path.join(outDir, "coverage")}`,
    "--reporter=json",
    `--outputFile=${path.join(outDir, "vitest.json")}`,
    "--reporter=dot",
  ];
  for (const project of projects) args.push("--project", project);
  const result = run(bin(root, "vitest"), args, { cwd: root });
  return { ok: result.status === 0, log: `${result.stdout}\n${result.stderr}` };
}

export function readTestResults(root: string, outDir: string, graph: Graph): Record<string, TestsAndCoverage> {
  const out: Record<string, TestsAndCoverage> = {};
  const ensure = (pkg: string) => (out[pkg] ??= { tests: null, coverage: null });

  const vitestFile = path.join(outDir, "vitest.json");
  if (existsSync(vitestFile)) {
    const report = parseJson<VitestJson>(readFileSync(vitestFile, "utf8"));
    for (const file of report?.testResults ?? []) {
      const pkg = packageForFile(graph, relative(root, file.name));
      if (!pkg) continue;
      const entry = ensure(pkg);
      entry.tests ??= { files: 0, tests: 0, passed: 0, failed: 0 };
      entry.tests.files++;
      for (const a of file.assertionResults) {
        entry.tests.tests++;
        if (a.status === "passed") entry.tests.passed++;
        else if (a.status === "failed") entry.tests.failed++;
      }
    }
  }

  const summaryFile = path.join(outDir, "coverage", "coverage-summary.json");
  if (existsSync(summaryFile)) {
    const summary = parseJson<Record<string, SummaryEntry>>(readFileSync(summaryFile, "utf8")) ?? {};
    const totals: Record<string, SummaryEntry> = {};
    for (const [file, entry] of Object.entries(summary)) {
      if (file === "total") continue;
      const pkg = packageForFile(graph, relative(root, file));
      if (!pkg) continue;
      const t = (totals[pkg] ??= empty());
      for (const k of ["lines", "statements", "branches", "functions"] as const) {
        t[k].total += entry[k].total;
        t[k].covered += entry[k].covered;
      }
    }
    for (const [pkg, t] of Object.entries(totals)) ensure(pkg).coverage = percentages(t);
  }
  return out;
}

function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function empty(): SummaryEntry {
  const zero = () => ({ total: 0, covered: 0 });
  return { lines: zero(), statements: zero(), branches: zero(), functions: zero() };
}

function percentages(t: SummaryEntry): Coverage {
  const pct = (x: { total: number; covered: number }) => (x.total === 0 ? 100 : round((x.covered / x.total) * 100));
  return { lines: pct(t.lines), statements: pct(t.statements), branches: pct(t.branches), functions: pct(t.functions) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
