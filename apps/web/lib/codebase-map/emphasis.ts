import type { Neighbourhood } from "@/lib/codebase-map/neighbourhood";
import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import { searchFiles } from "@/lib/codebase-map/search";
import type { MapFile, MapViewState } from "@/lib/codebase-map/types";

export type EmphasisLevel =
  | "focus"
  | "changed"
  | "neighbour"
  | "reached"
  | "impacted"
  | "context"
  | "dimmed";

/** Shape names, so emphasis never rests on colour alone. */
export const EMPHASIS_MARKERS: Record<EmphasisLevel, string> = {
  focus: "ring",
  changed: "filled-square",
  neighbour: "chevron",
  reached: "triangle",
  impacted: "outline-square",
  context: "outline-circle",
  dimmed: "hairline",
};

const EMPHASIS_RANK: Record<EmphasisLevel, number> = {
  focus: 0,
  changed: 1,
  neighbour: 2,
  reached: 3,
  impacted: 4,
  context: 5,
  dimmed: 6,
};

function lowerRank(a: EmphasisLevel, b: EmphasisLevel): EmphasisLevel {
  return EMPHASIS_RANK[a] <= EMPHASIS_RANK[b] ? a : b;
}

/** `reach` is the change's dependents by depth; it only counts while nothing is focused. */
export function emphasise(
  graph: NormalisedGraph,
  view: MapViewState,
  hood: Neighbourhood,
  impacted: (file: MapFile) => boolean,
  reach: ReadonlyMap<string, number> = new Map(),
): ReadonlyMap<string, EmphasisLevel> {
  const matches = new Set(searchFiles(graph.files, view.query).map((r) => r.path));
  const narrowed = hood.focus !== null || view.query.trim() !== "";
  const reaching = hood.focus === null;

  const emphasis = new Map<string, EmphasisLevel>();
  for (const file of graph.files) {
    const path = file.path;
    if (path === hood.focus) {
      emphasis.set(path, "focus");
    } else if (file.changed === true) {
      emphasis.set(path, "changed");
    } else if (hood.dependencies.has(path) || hood.dependents.has(path)) {
      emphasis.set(path, "neighbour");
    } else if (reaching && reach.has(path)) {
      emphasis.set(path, "reached");
    } else if (impacted(file)) {
      emphasis.set(path, "impacted");
    } else if (matches.has(path) || !narrowed) {
      emphasis.set(path, "context");
    } else {
      emphasis.set(path, "dimmed");
    }
  }
  return emphasis;
}

/** A collapsed group ranks as its strongest file, or by its counts when it is a summary. */
export function groupLevel(
  files: readonly string[],
  emphasis: ReadonlyMap<string, EmphasisLevel>,
  changedCount: number,
  impactedCount: number,
  reachedCount = 0,
): EmphasisLevel {
  let level: EmphasisLevel = "dimmed";
  for (const path of files) level = lowerRank(level, emphasis.get(path)!);
  if (files.length === 0) level = "context";
  // A summary's counts cover files not here to rank.
  if (changedCount > 0) level = lowerRank(level, "changed");
  if (reachedCount > 0) level = lowerRank(level, "reached");
  if (impactedCount > 0) level = lowerRank(level, "impacted");
  return level;
}
