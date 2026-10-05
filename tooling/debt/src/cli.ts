import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { affectedPackages } from "#src/affected";
import { loadBaseline, mergeIntoBaseline, saveBaseline } from "#src/baseline";
import { baselineDir, loadConfig, outDir } from "#src/config";
import type { GateResult } from "#src/gate";
import { runGate } from "#src/gate";
import type { Graph } from "#src/graph";
import { buildGraph, isolationViolations } from "#src/graph";
import type { Step } from "#src/metrics/collect";
import { collectMetrics } from "#src/metrics/collect";
import { gateReport } from "#src/report";
import { parseJson, run } from "#src/run";
import { scanWorkspace } from "#src/scan/scan";
import type { PackageMetrics, PackageScan, Snapshot } from "#src/snapshot";
import { stableJson } from "#src/snapshot";
import type { Workspace } from "#src/workspaces";
import { loadWorkspaces, repoRoot } from "#src/workspaces";

const USAGE = `Usage: pnpm debt <command> [options]

  graph       package graph, layers and public exports
  affected    packages changed against the base branch (and their dependents)
  scan        deterministic debt scan of every package -> .out/scan/scan.json
  metrics     tests, coverage, tsc, eslint, knip, deps, bundles -> .out/metrics/metrics.json
  gate        compare affected packages with the baseline; exit 1 on regression
  baseline    measure everything and record it as the new baseline

Options:
  --all                every package, not only the affected ones
  --packages a,b       an explicit package list
  --skip x,y           metrics steps to skip: tests, typecheck, lint, dead-code, network
  --no-measure         gate: reuse the last scan and metrics outputs
  --allow-api-change   gate: a removed export of a shared package is a warning, not a failure
  --force <reason>     baseline: record even when the gate is red
  --json               print machine-readable output
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: "boolean", default: false },
    packages: { type: "string" },
    skip: { type: "string", default: "" },
    "no-measure": { type: "boolean", default: false },
    "allow-api-change": { type: "boolean", default: false },
    force: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const log = (line: string) => {
  if (!values.json) process.stderr.write(`debt: ${line}\n`);
};

function selectPackages(graph: Graph): string[] {
  if (values.packages) return values.packages.split(",").map((s) => s.trim());
  return affectedPackages(repoRoot, graph, values.all).packages;
}

function writeOut(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function readOut<T>(file: string): T | null {
  return existsSync(file) ? parseJson<T>(readFileSync(file, "utf8")) : null;
}

function scanAll(workspaces: Workspace[]): Record<string, PackageScan> {
  const config = loadConfig();
  const out: Record<string, PackageScan> = {};
  for (const w of workspaces) out[w.name] = scanWorkspace(repoRoot, w, config);
  writeOut(path.join(outDir, "scan", "scan.json"), stableJson(out));
  return out;
}

function measure(workspaces: Workspace[], graph: Graph, packages: string[]) {
  const skip = new Set(values.skip.split(",").filter(Boolean) as Step[]);
  const collected = collectMetrics({
    root: repoRoot,
    outDir: path.join(outDir, "metrics"),
    config: loadConfig(),
    graph,
    workspaces,
    packages,
    skip,
    log,
  });
  writeOut(path.join(outDir, "metrics", "metrics.json"), stableJson(collected));
  return collected;
}

function assemble(
  workspaces: Workspace[],
  scans: Record<string, PackageScan>,
  metrics: { packages: Record<string, PackageMetrics>; overall: Snapshot["overall"] } | null,
): Snapshot {
  const snapshot: Snapshot = {
    packages: {},
    overall: metrics?.overall ?? { audit: null, outdated: null, duplicateVersions: null, lockfilePackages: null },
  };
  for (const w of workspaces) {
    const scan = scans[w.name];
    if (!scan) continue;
    snapshot.packages[w.name] = {
      package: w.name,
      dir: w.dir,
      exports: w.exports,
      scan,
      metrics: metrics?.packages[w.name] ?? null,
    };
  }
  return snapshot;
}

function publish(result: GateResult, snapshot: Snapshot, baseline: Snapshot | null): string {
  const report = gateReport(result, snapshot, baseline);
  writeOut(path.join(outDir, "gate", "report.md"), report);
  writeOut(path.join(outDir, "gate", "result.json"), stableJson(result));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${report}\n`);
  return report;
}

function main(): number {
  const command = positionals[0];
  if (!command || values.help) {
    process.stdout.write(USAGE);
    return command ? 0 : 1;
  }
  const workspaces = loadWorkspaces();
  const graph = buildGraph(workspaces);
  writeOut(path.join(outDir, "graph.json"), stableJson(graph));

  switch (command) {
    case "graph": {
      if (values.json) process.stdout.write(stableJson(graph));
      else {
        for (const [name, node] of Object.entries(graph.nodes).sort((a, b) => a[1].layer - b[1].layer)) {
          process.stdout.write(`L${node.layer} ${name} (${node.kind}) -> ${node.dependencies.join(", ") || "-"}\n`);
        }
        if (graph.cycles.length) process.stdout.write(`cycles: ${graph.cycles.map((c) => c.join(" -> ")).join("; ")}\n`);
      }
      const violations = isolationViolations(graph, loadConfig().gate.toolingMayDependOn);
      if (violations.length) process.stderr.write(`tooling depends on product: ${violations.join(", ")}\n`);
      return graph.cycles.length === 0 && violations.length === 0 ? 0 : 1;
    }
    case "affected": {
      const affected = affectedPackages(repoRoot, graph, values.all);
      process.stdout.write(values.json ? stableJson(affected) : `${affected.packages.join("\n")}\n`);
      log(`method=${affected.method} base=${affected.base ?? "none"}`);
      return 0;
    }
    case "scan": {
      const scans = scanAll(workspaces);
      if (values.json) process.stdout.write(stableJson(scans));
      else {
        for (const [name, scan] of Object.entries(scans)) {
          const hits = Object.entries(scan.categories)
            .filter(([, c]) => c.count > 0)
            .map(([k, c]) => `${k}=${c.count}`);
          process.stdout.write(`${name}: ${scan.files} files, ${hits.join(" ") || "clean"}\n`);
        }
      }
      return 0;
    }
    case "metrics": {
      const packages = selectPackages(graph);
      const collected = measure(workspaces, graph, packages);
      if (values.json) process.stdout.write(stableJson(collected));
      else process.stdout.write(`measured ${packages.length} package(s) -> tooling/debt/.out/metrics/metrics.json\n`);
      return 0;
    }
    case "gate": {
      const packages = selectPackages(graph);
      const scans = values["no-measure"]
        ? (readOut<Record<string, PackageScan>>(path.join(outDir, "scan", "scan.json")) ?? scanAll(workspaces))
        : scanAll(workspaces);
      const metrics = values["no-measure"]
        ? readOut<ReturnType<typeof measure>>(path.join(outDir, "metrics", "metrics.json"))
        : measure(workspaces, graph, packages);
      const snapshot = assemble(workspaces, scans, metrics);
      const baseline = loadBaseline(baselineDir);
      const result = runGate(baseline, snapshot, graph, loadConfig(), {
        packages,
        allowApiChange: values["allow-api-change"],
      });
      const report = publish(result, snapshot, baseline);
      process.stdout.write(values.json ? stableJson(result) : report);
      return result.ok ? 0 : 1;
    }
    case "baseline": {
      const all = workspaces.map((w) => w.name);
      const snapshot = assemble(workspaces, scanAll(workspaces), measure(workspaces, graph, all));
      if (Object.keys(snapshot.packages).length === 0) {
        process.stderr.write("debt: no workspaces found (is pnpm on PATH?); nothing recorded\n");
        return 1;
      }
      const previous = loadBaseline(baselineDir);
      const result = runGate(previous, snapshot, graph, loadConfig(), { packages: all, allowApiChange: true });
      const report = publish(result, snapshot, previous);
      if (!result.ok && values.force === undefined) {
        process.stdout.write(report);
        process.stderr.write("debt: gate is red; pass --force <reason> to record this baseline anyway\n");
        return 1;
      }
      const commit = run("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).stdout.trim() || (process.env.GITHUB_SHA ?? "");
      const written = saveBaseline(baselineDir, mergeIntoBaseline(previous, snapshot), {
        commit,
        reason: values.force ?? "gate green",
      });
      process.stdout.write(`baseline written: ${written.length} files in tooling/debt/baseline\n`);
      return 0;
    }
    default:
      process.stderr.write(`unknown command: ${command}\n${USAGE}`);
      return 1;
  }
}

process.exitCode = main();
