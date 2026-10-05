import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseJson } from "#src/run";
import type { OverallMetrics, PackageSnapshot, Snapshot } from "#src/snapshot";
import { baselineFileName, stableJson } from "#src/snapshot";

export interface BaselineMeta {
  commit: string;
  reason: string;
}

export function loadBaseline(dir: string): Snapshot | null {
  if (!existsSync(dir)) return null;
  const packages: Record<string, PackageSnapshot> = {};
  let overall: OverallMetrics | null = null;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const parsed = parseJson<unknown>(readFileSync(path.join(dir, file), "utf8"));
    if (file === "_overall.json") overall = parsed as OverallMetrics;
    else if (!file.startsWith("_") && parsed) {
      const snapshot = parsed as PackageSnapshot;
      packages[snapshot.package] = snapshot;
    }
  }
  if (Object.keys(packages).length === 0) return null;
  return { packages, overall: overall ?? { audit: null, outdated: null, duplicateVersions: null, lockfilePackages: null } };
}

export function saveBaseline(dir: string, snapshot: Snapshot, meta: BaselineMeta): string[] {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const pkg of Object.values(snapshot.packages)) {
    const file = baselineFileName(pkg.dir);
    writeFileSync(path.join(dir, file), stableJson(pkg));
    written.push(file);
  }
  writeFileSync(path.join(dir, "_overall.json"), stableJson(snapshot.overall));
  writeFileSync(path.join(dir, "_meta.json"), stableJson({ ...meta, generatedBy: "pnpm debt baseline" }));
  return [...written, "_overall.json", "_meta.json"];
}

// Keeps unmeasured packages' old entries, so a scoped run never erases the rest of the baseline.
export function mergeIntoBaseline(previous: Snapshot | null, fresh: Snapshot): Snapshot {
  return {
    packages: { ...previous?.packages, ...fresh.packages },
    overall: fresh.overall,
  };
}
