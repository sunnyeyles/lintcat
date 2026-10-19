import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseJson, run } from "#src/run";
import type { OverallMetrics } from "#src/snapshot";

interface AuditJson {
  metadata?: { vulnerabilities?: Record<string, number> };
}

function audit(root: string): OverallMetrics["audit"] {
  const result = run("pnpm", ["audit", "--json", "--prod"], { cwd: root, timeoutMs: 120_000 });
  const parsed = parseJson<AuditJson>(result.stdout);
  const vulns = parsed?.metadata?.vulnerabilities;
  return vulns ? { ...vulns } : null;
}

function outdated(root: string): number | null {
  const result = run("pnpm", ["outdated", "-r", "--json"], { cwd: root, timeoutMs: 120_000 });
  const parsed = parseJson<Record<string, unknown>>(result.stdout);
  return parsed ? Object.keys(parsed).length : null;
}

// Counts external packages resolved at more than one version, from the lockfile's `packages:` keys.
function lockfileStats(root: string): Pick<OverallMetrics, "duplicateVersions" | "lockfilePackages"> {
  const file = path.join(root, "pnpm-lock.yaml");
  if (!existsSync(file)) return { duplicateVersions: null, lockfilePackages: null };
  const versions = new Map<string, Set<string>>();
  let inPackages = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^\S/.test(line)) inPackages = line.startsWith("packages:");
    if (!inPackages) continue;
    const match = /^ {2}'?((?:@[^/'\s]+\/)?[^@'\s]+)@([^'(\s]+)/.exec(line);
    if (!match) continue;
    const set = versions.get(match[1]!) ?? new Set<string>();
    set.add(match[2]!);
    versions.set(match[1]!, set);
  }
  let duplicates = 0;
  for (const set of versions.values()) if (set.size > 1) duplicates++;
  return { duplicateVersions: duplicates, lockfilePackages: versions.size };
}

export function overallMetrics(root: string, network: boolean): OverallMetrics {
  return {
    audit: network ? audit(root) : null,
    outdated: network ? outdated(root) : null,
    ...lockfileStats(root),
  };
}
