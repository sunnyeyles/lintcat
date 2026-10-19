import { existsSync, statSync } from "node:fs";
import path from "node:path";

import type { Graph } from "#src/graph";
import { packageForFile } from "#src/graph";
import { bin, parseJson, run } from "#src/run";
import type { PackageMetrics } from "#src/snapshot";
import type { Workspace } from "#src/workspaces";

export function typecheck(root: string, workspace: Workspace): PackageMetrics["typecheck"] {
  if (!existsSync(path.join(workspace.path, "tsconfig.json"))) return null;
  const result = run(bin(root, "tsc"), ["--noEmit", "--pretty", "false"], { cwd: workspace.path });
  const errors = result.stdout.split("\n").filter((line) => /error TS\d+/.test(line)).length;
  return { errors: result.status === 0 ? 0 : Math.max(errors, 1) };
}

interface EslintFile {
  errorCount: number;
  warningCount: number;
}

export function lint(root: string, workspace: Workspace): PackageMetrics["lint"] {
  if (!existsSync(path.join(workspace.path, "eslint.config.js"))) return null;
  const result = run(bin(root, "eslint"), [".", "-f", "json"], { cwd: workspace.path });
  const files = parseJson<EslintFile[]>(result.stdout);
  if (!files) return null;
  return {
    errors: files.reduce((n, f) => n + f.errorCount, 0),
    warnings: files.reduce((n, f) => n + f.warningCount, 0),
  };
}

interface KnipIssue {
  file: string;
  dependencies?: unknown[];
  devDependencies?: unknown[];
  unlisted?: unknown[];
  exports?: unknown[];
  types?: unknown[];
}

interface KnipReport {
  files?: string[];
  issues?: KnipIssue[];
}

export function deadCode(root: string, graph: Graph): Record<string, NonNullable<PackageMetrics["deadCode"]>> {
  const out: Record<string, NonNullable<PackageMetrics["deadCode"]>> = {};
  for (const name of Object.keys(graph.nodes)) out[name] = { files: 0, exports: 0, types: 0, dependencies: 0 };
  const result = run(bin(root, "knip"), ["--reporter", "json", "--no-exit-code"], { cwd: root });
  const report = parseJson<KnipReport>(result.stdout);
  if (!report) return out;
  for (const file of report.files ?? []) {
    const pkg = packageForFile(graph, file);
    if (pkg) out[pkg]!.files++;
  }
  for (const issue of report.issues ?? []) {
    const pkg = packageForFile(graph, issue.file);
    if (!pkg) continue;
    const entry = out[pkg]!;
    entry.exports += issue.exports?.length ?? 0;
    entry.types += issue.types?.length ?? 0;
    entry.dependencies +=
      (issue.dependencies?.length ?? 0) + (issue.devDependencies?.length ?? 0) + (issue.unlisted?.length ?? 0);
  }
  return out;
}

export function bundleBytes(root: string, file: string | undefined): number | null {
  if (!file) return null;
  const abs = path.join(root, file);
  return existsSync(abs) ? statSync(abs).size : null;
}

export function depCounts(workspace: Workspace): PackageMetrics["deps"] {
  return {
    workspace: workspace.dependencies.length,
    external: Object.keys(workspace.external).length,
    externalDev: Object.keys(workspace.externalDev).length,
  };
}
