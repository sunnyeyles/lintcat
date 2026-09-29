import type { FindingHeat, MapSource } from "@/lib/codebase-map/from-snapshot";
import {
  DEFAULT_LOD_THRESHOLD,
  groupSlice,
  lodGraph,
  pathsInGroups,
  searchGroups,
  type GroupSlice,
  type LodOptions,
  type LodSearchResult,
} from "@/lib/codebase-map/lod";
import { MAX_REACH, reachOf } from "@/lib/codebase-map/neighbourhood";
import { normaliseGraph, type NormalisedGraph } from "@/lib/codebase-map/normalise";
import type { MapGraph } from "@/lib/codebase-map/types";

/** The most search results one question gets. */
export const SEARCH_LIMIT = 40;

export interface MapPayload {
  mode: "full" | "lod";
  graph: MapGraph;
  heat: FindingHeat;
  changedPaths: readonly string[];
}

export interface MapSearchAnswer {
  results: LodSearchResult[];
  /** The whole repo's size, not only what the map holds. */
  totalFileCount: number;
}

export interface MapQuery {
  /** Below the threshold the source is passed through untouched. */
  first(options?: LodOptions): MapPayload;
  /** Undefined when the repo has no file in that group. */
  expand(groupId: string, loadedGroups: readonly string[]): GroupSlice | undefined;
  search(query: string, limit?: number): MapSearchAnswer;
}

const NO_GRAPH: MapGraph = { files: [], imports: [] };

/** Every answer a map asks of its source; the graph is normalised once, on first use. */
export function mapQuery(source: MapSource): MapQuery {
  let normalised: NormalisedGraph | undefined;
  let reach: ReadonlyMap<string, number> | undefined;
  const graph = (): NormalisedGraph => (normalised ??= normaliseGraph(source.graph ?? NO_GRAPH));

  return {
    first(options = {}) {
      const threshold = options.threshold ?? DEFAULT_LOD_THRESHOLD;
      if (!source.graph || source.graph.files.length <= threshold) {
        return {
          mode: "full",
          graph: source.graph ?? { files: [], imports: [] },
          heat: source.heat,
          changedPaths: source.changedPaths,
        };
      }

      const lod = lodGraph(graph(), source.changedPaths, source.heat, options);
      const kept = new Set(lod.files.map((file) => file.path));
      const heat: FindingHeat = {};
      for (const path of kept) {
        const counts = source.heat[path];
        if (counts) heat[path] = counts;
      }

      return {
        mode: "lod",
        graph: lod,
        heat,
        changedPaths: source.changedPaths.filter((path) => kept.has(path)),
      };
    },

    expand(groupId, loadedGroups) {
      const all = graph();
      reach ??= reachOf(all, source.changedPaths, MAX_REACH);
      const held = pathsInGroups(all, loadedGroups);
      const slice = groupSlice(all, source.heat, groupId, held, reach);
      return slice.graph.files.length > 0 ? slice : undefined;
    },

    search(query, limit = SEARCH_LIMIT) {
      const all = graph();
      return {
        results: searchGroups(all, query, Math.min(limit, SEARCH_LIMIT)),
        totalFileCount: all.files.length,
      };
    },
  };
}
