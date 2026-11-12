/** Summaries and a side-by-side table of two configurations' benchmark results. */
import { percentile } from "#src/metrics";
import type { BenchResult } from "#src/bench/runner";

interface BenchSummary {
  results: number;
  verified: number;
  verifiedRate: number | null;
  claimedDelivered: number;
  /** Delivered by the factory's own checks, failed by the hidden ones. */
  falseClaims: number;
  firstPassRate: number | null;
  medianWallMs: number | null;
  costPerVerifiedUsd: number | null;
}

const ratio = (part: number, whole: number) => (whole === 0 ? null : part / whole);

function summariseBench(results: readonly BenchResult[]): BenchSummary {
  const verified = results.filter((r) => r.verified);
  const delivered = results.filter((r) => r.factoryStatus === "delivered");
  const costs = results.map((r) => r.estimatedCostUsd).filter((c): c is number => c !== null);
  const walls = results.map((r) => r.wallTimeMs).filter((w): w is number => w !== null);
  return {
    results: results.length,
    verified: verified.length,
    verifiedRate: ratio(verified.length, results.length),
    claimedDelivered: delivered.length,
    falseClaims: delivered.filter((r) => !r.hidden.passed).length,
    firstPassRate: ratio(verified.filter((r) => r.repairs === 0).length, results.length),
    medianWallMs: percentile(walls, 50),
    costPerVerifiedUsd: costs.length === 0 || verified.length === 0 ? null : costs.reduce((s, c) => s + c, 0) / verified.length,
  };
}

const groupBy = (results: readonly BenchResult[], key: (r: BenchResult) => string) => {
  const map = new Map<string, BenchResult[]>();
  for (const r of results) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
  return map;
};

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);
const secs = (v: number | null) => (v === null ? "-" : `${(v / 1000).toFixed(1)}s`);
const usd = (v: number | null) => (v === null ? "-" : `$${v.toFixed(2)}`);

function delta(a: number | null, b: number | null, format: (v: number) => string): string {
  if (a === null || b === null) return "-";
  const d = b - a;
  return d === 0 ? "0" : `${d > 0 ? "+" : "-"}${format(Math.abs(d))}`;
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((row) => row[c]!.length)));
  return rows.map((row) => row.map((cell, c) => cell.padEnd(widths[c]!)).join("  ").trimEnd()).join("\n");
}

function describe(label: string, results: readonly BenchResult[]): string {
  const first = results[0];
  const versions = (pick: (r: BenchResult) => string[]) => [...new Set(results.flatMap(pick))].sort().join(", ") || "-";
  return [
    `${label}: ${first ? `${first.config.name}@${first.config.hash.slice(0, 8)}` : "(empty)"}${first?.config.model ? ` model=${first.config.model}` : ""}`,
    `   ${results.length} result(s); workflows ${versions((r) => (r.workflowVersion ? [`${r.profile}@${r.workflowVersion}`] : []))}; prompts ${versions((r) => r.promptVersions)}`,
  ].join("\n");
}

/** Per-profile rows with deltas (B − A), then per-fixture verified counts. Costs are runtime estimates. */
export function renderComparison(a: readonly BenchResult[], b: readonly BenchResult[]): string {
  const profileOf = (r: BenchResult) => r.profile ?? "(none)";
  const byA = groupBy(a, profileOf);
  const byB = groupBy(b, profileOf);
  const profiles = [...new Set([...byA.keys(), ...byB.keys()])].sort();
  const rows: string[][] = [["profile", "metric", "A", "B", "Δ"]];
  for (const profile of profiles) {
    const sa = summariseBench(byA.get(profile) ?? []);
    const sb = summariseBench(byB.get(profile) ?? []);
    const metrics: [string, string, string, string][] = [
      ["verified (hidden checks)", `${sa.verified}/${sa.results} ${pct(sa.verifiedRate)}`, `${sb.verified}/${sb.results} ${pct(sb.verifiedRate)}`, delta(sa.verifiedRate, sb.verifiedRate, (v) => pct(v))],
      ["first-pass rate", pct(sa.firstPassRate), pct(sb.firstPassRate), delta(sa.firstPassRate, sb.firstPassRate, (v) => pct(v))],
      ["false claims", String(sa.falseClaims), String(sb.falseClaims), delta(sa.falseClaims, sb.falseClaims, String)],
      ["median wall time", secs(sa.medianWallMs), secs(sb.medianWallMs), delta(sa.medianWallMs, sb.medianWallMs, (v) => secs(v))],
      ["est. cost / verified", usd(sa.costPerVerifiedUsd), usd(sb.costPerVerifiedUsd), delta(sa.costPerVerifiedUsd, sb.costPerVerifiedUsd, (v) => usd(v))],
    ];
    metrics.forEach((metric, index) => rows.push([index === 0 ? profile : "", ...metric]));
  }
  const fixtureRows: string[][] = [["fixture", "A verified", "B verified"]];
  const fa = groupBy(a, (r) => r.fixture.name);
  const fb = groupBy(b, (r) => r.fixture.name);
  for (const fixture of [...new Set([...fa.keys(), ...fb.keys()])].sort()) {
    const count = (rs: BenchResult[] | undefined) => (rs ? `${rs.filter((r) => r.verified).length}/${rs.length}` : "-");
    fixtureRows.push([fixture, count(fa.get(fixture)), count(fb.get(fixture))]);
  }
  return [
    describe("A", a),
    describe("B", b),
    "",
    table(rows),
    "",
    table(fixtureRows),
    "",
    "Verified means delivered and passing the hidden checks; cost is the runtime's estimate (notional on a subscription).",
  ].join("\n");
}
