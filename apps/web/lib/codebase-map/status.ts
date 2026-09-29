import { groupIdFor } from "@/lib/codebase-map/clustering";
import type { NormalisedGraph } from "@/lib/codebase-map/normalise";

type MapStatusKind = "empty" | "no-changes" | "partial" | "ready";

type StatusReasonCode =
  | "level-of-detail"
  | "overlay-missing"
  | "overlay-partial"
  | "group-imports-capped"
  | "unresolved-imports"
  | "tests-hidden"
  | "truncated"
  | "unknown-changed-flags"
  | "unknown-dead-flags"
  | "unknown-cycle-flags";

interface StatusReason {
  code: StatusReasonCode;
  count: number;
  message: string;
}

interface FlagCoverage {
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** `hiddenTests` is what the view left out, so the banner never hides a gap it made. */
export function mapStatus(graph: NormalisedGraph, hiddenTests = 0): MapStatus {
  const fileCount = graph.files.length;
  const coverage: FlagCoverage = { changed: 0, dead: 0, inCycle: 0 };
  let changedCount = 0;

  const heldChanged = new Map<string, number>();
  for (const file of graph.files) {
    if (file.changed !== undefined) coverage.changed += 1;
    if (file.dead !== undefined) coverage.dead += 1;
    if (file.inCycle !== undefined) coverage.inCycle += 1;
    if (file.changed !== true) continue;
    changedCount += 1;
    const id = groupIdFor(file);
    heldChanged.set(id, (heldChanged.get(id) ?? 0) + 1);
  }
  // A partial group's changed files are already counted above.
  for (const summary of graph.summaries) {
    changedCount += Math.max(0, summary.changedCount - (heldChanged.get(summary.id) ?? 0));
  }

  const reasons: StatusReason[] = [];
  if (graph.summaries.length > 0) {
    reasons.push({
      code: "level-of-detail",
      count: graph.totalFileCount,
      message: "Large repo: showing packages, expand to see files.",
    });
  }
  if (graph.overlay === "absent") {
    reasons.push({
      code: "overlay-missing",
      count: 0,
      message: "The PR overlay could not be built, so this is the base commit only.",
    });
  }
  const overlaid = graph.files.filter((file) => file.change !== undefined).length;
  if (graph.overlay === "partial") {
    reasons.push({
      code: "overlay-partial",
      count: overlaid,
      message: `The PR overlay covers only some of the changed files (${overlaid} drawn as merged).`,
    });
  }
  if (graph.groupImportsDropped > 0) {
    const dropped = graph.groupImportsDropped;
    reasons.push({
      code: "group-imports-capped",
      count: dropped,
      message: `${plural(dropped, "group edge")} left out to keep the map small, so some coupling is not drawn.`,
    });
  }
  const unresolved = graph.unresolvedImportCount ?? 0;
  if (unresolved > 0) {
    reasons.push({
      code: "unresolved-imports",
      count: unresolved,
      message: `${plural(unresolved, "import")} the indexer could not resolve, so those edges are missing.`,
    });
  }
  if (hiddenTests > 0) {
    reasons.push({
      code: "tests-hidden",
      count: hiddenTests,
      message: `${plural(hiddenTests, "test file")} hidden. Turn on "Show tests" to see them.`,
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
