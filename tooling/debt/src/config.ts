import { readFileSync } from "node:fs";
import path from "node:path";

import { repoRoot } from "#src/workspaces";

type Severity = "low" | "medium" | "high";

interface LineRule {
  severity: Severity;
  scope: "code" | "text";
  pattern: string;
  excludeTests?: boolean;
  excludePackages?: string[];
  why: string;
}

export interface DebtConfig {
  exclude: string[];
  testFilePattern: string;
  lineRules: Record<string, LineRule>;
  fileRules: {
    "long-file": { severity: Severity; maxLines: number; maxTestLines: number; allowedGrowthPct: number; why: string };
    "untested-module": { severity: Severity; exclude: string[]; why: string };
  };
  gate: { coverageDropPct: number; bundleGrowthPct: number; toolingMayDependOn: string[] };
  metrics: { bundles: Record<string, string>; coverageInclude: string[] };
}

const configPath = path.join(repoRoot, "tooling/debt/debt.config.json");
export const outDir = path.join(repoRoot, "tooling/debt/.out");
export const baselineDir = path.join(repoRoot, "tooling/debt/baseline");

export function loadConfig(file = configPath): DebtConfig {
  return JSON.parse(readFileSync(file, "utf8")) as DebtConfig;
}
