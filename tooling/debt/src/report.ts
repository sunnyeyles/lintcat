import type { GateResult } from "#src/gate";
import type { Snapshot } from "#src/snapshot";

const fmt = (v: number | string | null | undefined) => (v === undefined || v === null ? "" : String(v));

export function gateReport(result: GateResult, current: Snapshot, baseline: Snapshot | null): string {
  const lines: string[] = [];
  lines.push(`# Debt gate: ${result.ok ? "green" : "RED"}`, "");
  lines.push(`Compared ${result.compared.length} package(s)${result.compared.length ? `: ${result.compared.join(", ")}` : ""}.`);
  if (result.unbaselined.length > 0) {
    lines.push(`No baseline yet for: ${result.unbaselined.join(", ")} (run \`pnpm debt baseline\`).`);
  }
  lines.push("");

  for (const level of ["fail", "warn", "info"] as const) {
    const rows = result.findings.filter((f) => f.level === level);
    if (rows.length === 0) continue;
    lines.push(`## ${{ fail: "Regressions", warn: "Warnings", info: "Improvements" }[level]}`, "");
    lines.push("| Package | Check | Baseline | Current | Detail |", "|---|---|---:|---:|---|");
    for (const f of rows) {
      lines.push(`| ${f.package} | ${f.check} | ${fmt(f.baseline)} | ${fmt(f.current)} | ${f.message} |`);
    }
    lines.push("");
  }

  lines.push("## Snapshot", "");
  lines.push("| Package | Files | Debt hits | Untested | Coverage (lines) | Tests | Bundle |", "|---|---:|---:|---:|---:|---:|---:|");
  for (const name of Object.keys(current.packages).sort()) {
    const p = current.packages[name]!;
    const m = p.metrics;
    const debt = Object.entries(p.scan.categories)
      .filter(([k]) => k !== "untested-module")
      .reduce((n, [, c]) => n + c.count, 0);
    lines.push(
      `| ${name} | ${p.scan.files} | ${debt} | ${p.scan.categories["untested-module"]?.count ?? ""} | ${fmt(m?.coverage?.lines)} | ${fmt(m?.tests?.tests)} | ${fmt(m?.bundleBytes)} |`,
    );
  }
  lines.push("");
  lines.push("## Repo-wide (report only)", "");
  lines.push("| Metric | Baseline | Current |", "|---|---:|---:|");
  const o = current.overall;
  const b = baseline?.overall;
  const vulns = (a: Record<string, number> | null | undefined) =>
    a ? Object.entries(a).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(", ") || "0" : "unmeasured";
  lines.push(`| Vulnerabilities | ${vulns(b?.audit)} | ${vulns(o.audit)} |`);
  lines.push(`| Outdated deps | ${b?.outdated ?? "unmeasured"} | ${o.outdated ?? "unmeasured"} |`);
  lines.push(`| Duplicate versions | ${fmt(b?.duplicateVersions)} | ${fmt(o.duplicateVersions)} |`);
  lines.push(`| Lockfile packages | ${fmt(b?.lockfilePackages)} | ${fmt(o.lockfilePackages)} |`);
  lines.push("");
  return lines.join("\n");
}
