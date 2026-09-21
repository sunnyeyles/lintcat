import type { Severity } from "@pr-review/db/dashboard";
import type { RepositoryGraphSnapshot } from "@pr-review/index";
import type { ReviewRecordChangedFile } from "@pr-review/schemas";

import type { MapFile, MapGraph, MapImport } from "@/lib/codebase-map/types";

export const SEVERITIES = ["high", "medium", "low"] as const;

export interface FindingCounts {
  total: number;
  high: number;
  medium: number;
  low: number;
}

/** Counts per path, plain so it crosses the server boundary unchanged. */
export type FindingHeat = Record<string, FindingCounts>;

export interface MapSourceFinding {
  file: string;
  severity: Severity;
}

export interface MapSource {
  /** Undefined when no snapshot was stored: the index was off or it failed. */
  graph: MapGraph | undefined;
  heat: FindingHeat;
  /** Changed files the graph actually holds, for the opening view. */
  changedPaths: readonly string[];
}

function empty(): FindingCounts {
  return { total: 0, high: 0, medium: 0, low: 0 };
}

function boolish(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function packageAt(
  path: string,
  packages: readonly { name: string; root: string }[],
): string | undefined {
  let best: string | undefined;
  let bestLength = -1;
  for (const workspace of packages) {
    const prefix = workspace.root === "" ? "" : `${workspace.root}/`;
    if (path.startsWith(prefix) && workspace.root.length > bestLength) {
      best = workspace.name;
      bestLength = workspace.root.length;
    }
  }
  return best;
}

export function findingHeat(findings: readonly MapSourceFinding[]): FindingHeat {
  const heat: FindingHeat = {};
  for (const finding of findings) {
    const path = typeof finding?.file === "string" ? finding.file.trim() : "";
    if (!path) continue;
    const counts = (heat[path] ??= empty());
    counts.total += 1;
    if (finding.severity === "high") counts.high += 1;
    else if (finding.severity === "medium") counts.medium += 1;
    else if (finding.severity === "low") counts.low += 1;
  }
  return heat;
}

export function mapFromSnapshot(
  snapshot: RepositoryGraphSnapshot | undefined,
  changedFiles: readonly ReviewRecordChangedFile[],
  findings: readonly MapSourceFinding[],
): MapSource {
  const heat = findingHeat(findings);
  if (!snapshot) return { graph: undefined, heat, changedPaths: [] };

  const changedStatus = new Map<string, ReviewRecordChangedFile["status"]>();
  for (const file of changedFiles ?? []) {
    const path = typeof file?.path === "string" ? file.path.trim() : "";
    if (path) changedStatus.set(path, file.status);
  }

  // An empty list is "nobody recorded it", so no file may be called unchanged.
  const listed = changedStatus.size > 0;

  const files: MapFile[] = [];
  const known = new Set<string>();
  for (const file of snapshot.files ?? []) {
    known.add(file.path);
    const next: MapFile = { path: file.path };
    if (listed) next.changed = changedStatus.has(file.path);
    if (file.role !== undefined) next.role = file.role;
    if (file.package !== undefined) next.package = file.package;
    const dead = boolish(file.dead);
    if (dead !== undefined) next.dead = dead;
    const inCycle = boolish(file.inCycle);
    if (inCycle !== undefined) next.inCycle = inCycle;
    files.push(next);
  }

  // The snapshot is the base commit, so a file the PR adds is only in the changed list.
  for (const [path, status] of changedStatus) {
    if (known.has(path) || status === "removed") continue;
    const next: MapFile = { path, changed: true };
    const workspace = packageAt(path, snapshot.packages ?? []);
    if (workspace !== undefined) next.package = workspace;
    files.push(next);
  }

  const imports: MapImport[] = (snapshot.edges ?? []).map((edge) => ({
    from: edge.from,
    to: edge.to,
  }));

  const graph: MapGraph = { files, imports, truncated: snapshot.truncated === true };
  const changedPaths = files
    .filter((file) => file.changed === true)
    .map((file) => file.path)
    .sort();

  return { graph, heat, changedPaths };
}
