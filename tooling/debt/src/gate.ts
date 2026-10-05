import type { DebtConfig } from "#src/config";
import type { Graph } from "#src/graph";
import { isolationViolations } from "#src/graph";
import type { PackageSnapshot, Snapshot } from "#src/snapshot";

type Level = "fail" | "warn" | "info";

interface Finding {
  level: Level;
  package: string;
  check: string;
  message: string;
  baseline?: number | string | null;
  current?: number | string | null;
}

export interface GateOptions {
  packages: string[];
  allowApiChange: boolean;
}

export interface GateResult {
  ok: boolean;
  findings: Finding[];
  compared: string[];
  unbaselined: string[];
}

export function runGate(
  baseline: Snapshot | null,
  current: Snapshot,
  graph: Graph,
  config: DebtConfig,
  options: GateOptions,
): GateResult {
  const findings: Finding[] = [];
  const compared: string[] = [];
  const unbaselined: string[] = [];

  for (const name of options.packages.sort()) {
    const now = current.packages[name];
    if (!now) continue;
    const before = baseline?.packages[name];
    if (!before) {
      unbaselined.push(name);
      continue;
    }
    compared.push(name);
    compareScan(before, now, config, findings);
    compareMetrics(before, now, config, findings);
    compareExports(before, now, graph, options.allowApiChange, findings);
  }
  if (graph.cycles.length > 0) {
    findings.push({
      level: "fail",
      package: "*",
      check: "cycles",
      message: `dependency cycle: ${graph.cycles.map((c) => c.join(" -> ")).join("; ")}`,
    });
  }
  for (const edge of isolationViolations(graph, config.gate.toolingMayDependOn)) {
    findings.push({ level: "fail", package: "*", check: "isolation", message: `tooling depends on product: ${edge}` });
  }
  return { ok: !findings.some((f) => f.level === "fail"), findings, compared, unbaselined };
}

function compareScan(before: PackageSnapshot, now: PackageSnapshot, config: DebtConfig, out: Finding[]) {
  for (const [category, hits] of Object.entries(now.scan.categories)) {
    const was = before.scan.categories[category];
    if (!was) continue;
    const base = { package: now.package, check: category };
    if (hits.count > was.count) {
      out.push({ ...base, level: "fail", message: "count rose", baseline: was.count, current: hits.count });
    } else if (hits.count < was.count) {
      out.push({ ...base, level: "info", message: "count fell", baseline: was.count, current: hits.count });
    }
    const newFiles = Object.keys(hits.files).filter((f) => !(f in was.files));
    if (newFiles.length > 0 && hits.count >= was.count) {
      out.push({ ...base, level: "fail", message: `new in ${newFiles.join(", ")}` });
    } else if (newFiles.length > 0) {
      out.push({ ...base, level: "warn", message: `moved into ${newFiles.join(", ")} while the total fell` });
    }
    if (category === "long-file") {
      const growth = config.fileRules["long-file"].allowedGrowthPct;
      for (const [file, lines] of Object.entries(hits.files)) {
        const previous = was.files[file];
        if (previous !== undefined && lines > previous * (1 + growth / 100)) {
          out.push({ ...base, level: "fail", message: `${file} grew`, baseline: previous, current: lines });
        }
      }
    }
  }
}

function compareMetrics(before: PackageSnapshot, now: PackageSnapshot, config: DebtConfig, out: Finding[]) {
  const a = before.metrics;
  const b = now.metrics;
  if (!a || !b) return;
  const base = { package: now.package };

  if (a.coverage && b.coverage) {
    const drop = a.coverage.lines - b.coverage.lines;
    if (drop > config.gate.coverageDropPct) {
      out.push({ ...base, level: "fail", check: "coverage", message: "line coverage fell", baseline: a.coverage.lines, current: b.coverage.lines });
    } else if (drop < -config.gate.coverageDropPct) {
      out.push({ ...base, level: "info", check: "coverage", message: "line coverage rose", baseline: a.coverage.lines, current: b.coverage.lines });
    }
  }
  if (b.tests && b.tests.failed > 0) {
    out.push({ ...base, level: "fail", check: "tests", message: "failing tests", current: b.tests.failed });
  }
  if (a.tests && b.tests && b.tests.tests < a.tests.tests) {
    out.push({ ...base, level: "warn", check: "tests", message: "fewer tests", baseline: a.tests.tests, current: b.tests.tests });
  }
  if (a.typecheck && b.typecheck && b.typecheck.errors > a.typecheck.errors) {
    out.push({ ...base, level: "fail", check: "typecheck", message: "more type errors", baseline: a.typecheck.errors, current: b.typecheck.errors });
  }
  if (a.lint && b.lint) {
    if (b.lint.errors > a.lint.errors) {
      out.push({ ...base, level: "fail", check: "lint", message: "more lint errors", baseline: a.lint.errors, current: b.lint.errors });
    }
    if (b.lint.warnings > a.lint.warnings) {
      out.push({ ...base, level: "warn", check: "lint", message: "more lint warnings", baseline: a.lint.warnings, current: b.lint.warnings });
    }
  }
  if (a.bundleBytes !== null && b.bundleBytes !== null) {
    const limit = a.bundleBytes * (1 + config.gate.bundleGrowthPct / 100);
    if (b.bundleBytes > limit) {
      out.push({ ...base, level: "fail", check: "bundle", message: `grew past ${config.gate.bundleGrowthPct}%`, baseline: a.bundleBytes, current: b.bundleBytes });
    }
  }
}

function compareExports(before: PackageSnapshot, now: PackageSnapshot, graph: Graph, allow: boolean, out: Finding[]) {
  if (graph.nodes[now.package]?.kind !== "package") return;
  const removed = before.exports.filter((e) => !now.exports.includes(e));
  if (removed.length === 0) return;
  out.push({
    level: allow ? "warn" : "fail",
    package: now.package,
    check: "public-api",
    message: `exports removed: ${removed.join(", ")}${allow ? " (allowed)" : ""}`,
  });
}
