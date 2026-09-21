import type { NormalisedGraph } from "@/lib/codebase-map/normalise";

export type MapStatusKind = "empty" | "no-changes" | "partial" | "ready";

export type StatusReasonCode =
  | "level-of-detail"
  | "unresolved-imports"
  | "truncated"
  | "unknown-changed-flags"
  | "unknown-dead-flags"
  | "unknown-cycle-flags";

export interface StatusReason {
  code: StatusReasonCode;
  count: number;
  message: string;
}

export interface FlagCoverage {
  changed: number;
  dead: number;
  inCycle: number;
}

export interface MapStatus {
  kind: MapStatusKind;
  reasons: readonly StatusReason[];
  fileCount: number;
  /** The repo's size, above `fileCount` only while summaries stand in for files. */
  totalFileCount: number;
  changedCount: number;
  flagCoverage: FlagCoverage;
}

export function mapStatus(graph: NormalisedGraph): MapStatus {
  const fileCount = graph.files.length;
  const coverage: FlagCoverage = { changed: 0, dead: 0, inCycle: 0 };
  let changedCount = 0;

  for (const file of graph.files) {
    if (file.changed !== undefined) coverage.changed += 1;
    if (file.dead !== undefined) coverage.dead += 1;
    if (file.inCycle !== undefined) coverage.inCycle += 1;
    if (file.changed === true) changedCount += 1;
  }
  for (const summary of graph.summaries) changedCount += summary.changedCount;

  const reasons: StatusReason[] = [];
  if (graph.summaries.length > 0) {
    reasons.push({
      code: "level-of-detail",
      count: graph.totalFileCount,
      message: "Large repo: showing packages, expand to see files.",
    });
  }
  const unresolved = graph.dropped.unresolvedImports;
  if (unresolved > 0) {
    reasons.push({
      code: "unresolved-imports",
      count: unresolved,
      message: `${unresolved} import${unresolved === 1 ? "" : "s"} point at files this map doesn't have.`,
    });
  }
  if (graph.truncated) {
    reasons.push({
      code: "truncated",
      count: fileCount,
      message: "The index was truncated, so files are missing from this map.",
    });
  }

  const unknownChanged = fileCount - coverage.changed;
  const unknownDead = fileCount - coverage.dead;
  const unknownCycle = fileCount - coverage.inCycle;
  if (unknownChanged > 0) {
    reasons.push({
      code: "unknown-changed-flags",
      count: unknownChanged,
      message: `Change data is unknown for ${unknownChanged} file${unknownChanged === 1 ? "" : "s"}.`,
    });
  }
  if (unknownDead > 0) {
    reasons.push({
      code: "unknown-dead-flags",
      count: unknownDead,
      message: `Dead-file data is unknown for ${unknownDead} file${unknownDead === 1 ? "" : "s"}, not clean.`,
    });
  }
  if (unknownCycle > 0) {
    reasons.push({
      code: "unknown-cycle-flags",
      count: unknownCycle,
      message: `Cycle data is unknown for ${unknownCycle} file${unknownCycle === 1 ? "" : "s"}, not cycle-free.`,
    });
  }

  // "No changes" needs every changed flag present; an absent flag is unknown, never false.
  const kind: MapStatusKind =
    fileCount === 0
      ? "empty"
      : reasons.length > 0
        ? "partial"
        : changedCount === 0
          ? "no-changes"
          : "ready";

  return {
    kind,
    reasons,
    fileCount,
    totalFileCount: graph.totalFileCount,
    changedCount,
    flagCoverage: coverage,
  };
}
