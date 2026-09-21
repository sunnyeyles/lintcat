import { neighbourhood } from "@/lib/codebase-map/neighbourhood";
import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import { searchFiles } from "@/lib/codebase-map/search";
import type { MapViewState } from "@/lib/codebase-map/types";

export type EmphasisLevel = "focus" | "changed" | "neighbour" | "context" | "dimmed";

/** Shape names, so emphasis never rests on colour alone. */
export const EMPHASIS_MARKERS: Record<EmphasisLevel, string> = {
  focus: "ring",
  changed: "filled-square",
  neighbour: "chevron",
  context: "outline-circle",
  dimmed: "hairline",
};

export const EMPHASIS_RANK: Record<EmphasisLevel, number> = {
  focus: 0,
  changed: 1,
  neighbour: 2,
  context: 3,
  dimmed: 4,
};

export interface FileEmphasis {
  path: string;
  level: EmphasisLevel;
  marker: string;
  rank: number;
}

function at(path: string, level: EmphasisLevel): FileEmphasis {
  return { path, level, marker: EMPHASIS_MARKERS[level], rank: EMPHASIS_RANK[level] };
}

export function emphasise(
  graph: NormalisedGraph,
  view: MapViewState,
  steps = 1,
): ReadonlyMap<string, FileEmphasis> {
  const hood = neighbourhood(graph, view.focusedPath, steps);
  const matches = new Set(searchFiles(graph.files, view.query).map((r) => r.path));
  const narrowed = hood.focus !== null || view.query.trim() !== "";

  const emphasis = new Map<string, FileEmphasis>();
  for (const file of graph.files) {
    const path = file.path;
    if (path === hood.focus) {
      emphasis.set(path, at(path, "focus"));
    } else if (file.changed === true) {
      emphasis.set(path, at(path, "changed"));
    } else if (hood.dependencies.has(path) || hood.dependents.has(path)) {
      emphasis.set(path, at(path, "neighbour"));
    } else if (matches.has(path) || !narrowed) {
      emphasis.set(path, at(path, "context"));
    } else {
      emphasis.set(path, at(path, "dimmed"));
    }
  }
  return emphasis;
}
