import type { Neighbourhood } from "@/lib/codebase-map/neighbourhood";
import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import { searchFiles } from "@/lib/codebase-map/search";
import type { MapFile, MapViewState } from "@/lib/codebase-map/types";

export type EmphasisLevel =
  | "focus"
  | "changed"
  | "neighbour"
  | "impacted"
  | "context"
  | "dimmed";

/** Shape names, so emphasis never rests on colour alone. */
export const EMPHASIS_MARKERS: Record<EmphasisLevel, string> = {
  focus: "ring",
  changed: "filled-square",
  neighbour: "chevron",
  impacted: "outline-square",
  context: "outline-circle",
  dimmed: "hairline",
};

const EMPHASIS_RANK: Record<EmphasisLevel, number> = {
  focus: 0,
  changed: 1,
  neighbour: 2,
  impacted: 3,
  context: 4,
  dimmed: 5,
};

function lowerRank(a: EmphasisLevel, b: EmphasisLevel): EmphasisLevel {
  return EMPHASIS_RANK[a] <= EMPHASIS_RANK[b] ? a : b;
}

export function emphasise(
  graph: NormalisedGraph,
  view: MapViewState,
  hood: Neighbourhood,
  impacted: (file: MapFile) => boolean,
): ReadonlyMap<string, EmphasisLevel> {
  const matches = new Set(searchFiles(graph.files, view.query).map((r) => r.path));
  const narrowed = hood.focus !== null || view.query.trim() !== "";

  const emphasis = new Map<string, EmphasisLevel>();
  for (const file of graph.files) {
    const path = file.path;
    if (path === hood.focus) {
      emphasis.set(path, "focus");
    } else if (file.changed === true) {
      emphasis.set(path, "changed");
    } else if (hood.dependencies.has(path) || hood.dependents.has(path)) {
      emphasis.set(path, "neighbour");
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
): EmphasisLevel {
  let level: EmphasisLevel = "dimmed";
  for (const path of files) level = lowerRank(level, emphasis.get(path)!);
  if (files.length === 0) level = changedCount > 0 ? "changed" : "context";
  // A summary's count covers files not here to rank.
  if (impactedCount > 0) level = lowerRank(level, "impacted");
  return level;
}
