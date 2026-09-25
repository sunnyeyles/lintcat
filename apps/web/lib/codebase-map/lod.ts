import { clusterGraph, groupIdFor, type MapGroup } from "@/lib/codebase-map/clustering";
import type { FindingHeat, MapSource } from "@/lib/codebase-map/from-snapshot";
import { sumHeat } from "@/lib/codebase-map/heat";
import { neighbourhoodOf } from "@/lib/codebase-map/neighbourhood";
import { normaliseGraph, type NormalisedGraph } from "@/lib/codebase-map/normalise";
import { searchFiles, type SearchResult } from "@/lib/codebase-map/search";
import type {
  GroupImport,
  GroupSummary,
  MapGraph,
  MapViewState,
} from "@/lib/codebase-map/types";

/** Above this many files the payload becomes summaries plus the change. */
export const DEFAULT_LOD_THRESHOLD = 5000;

/** What the first level-of-detail payload may carry, so its size is capped. */
export const DEFAULT_LOD_BUDGET = { openFiles: 2500, groupImports: 800 } as const;

export interface LodOptions {
  threshold?: number;
  openFiles?: number;
  groupImports?: number;
}

type MapMode = "full" | "lod";

export interface MapPayload {
  mode: MapMode;
  graph: MapGraph;
  heat: FindingHeat;
  changedPaths: readonly string[];
}

/** Env wins over the default; an option wins over both. */
export function resolveLodThreshold(raw: string | undefined, override?: number): number {
  if (override !== undefined && Number.isFinite(override)) return Math.max(0, override);
  const parsed = Number(raw);
  if (raw !== undefined && raw.trim() !== "" && Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed);
  }
  return DEFAULT_LOD_THRESHOLD;
}

const SHUT: MapViewState = { focusedPath: null, query: "", expandedGroups: new Set() };

/**
 * Groups worth sending whole: the ones holding a changed file first, then the
 * ones a change reaches in one step, until the file budget runs out.
 */
function openGroups(
  groups: readonly MapGroup[],
  changedPaths: readonly string[],
  reached: ReadonlySet<string>,
  budget: number,
): ReadonlySet<string> {
  const changedSet = new Set(changedPaths);
  const scored = groups.map((group) => {
    let changed = 0;
    let touched = 0;
    for (const path of group.files) {
      if (changedSet.has(path)) changed += 1;
      if (reached.has(path)) touched += 1;
    }
    return { group, changed, touched };
  });

  scored.sort(
    (a, b) =>
      b.changed - a.changed ||
      b.touched - a.touched ||
      a.group.files.length - b.group.files.length ||
      (a.group.id < b.group.id ? -1 : 1),
  );

  const open = new Set<string>();
  let spent = 0;
  for (const { group, changed, touched } of scored) {
    if (changed === 0 && touched === 0) break;
    if (spent + group.files.length > budget && open.size > 0) continue;
    open.add(group.id);
    spent += group.files.length;
  }
  return open;
}

/**
 * The bounded first payload: every group as a summary, and the files and edges
 * of the groups the change actually lands in.
 */
export function lodGraph(
  graph: NormalisedGraph,
  changedPaths: readonly string[],
  heat: FindingHeat,
  options: LodOptions = {},
): MapGraph {
  const budget = options.openFiles ?? DEFAULT_LOD_BUDGET.openFiles;
  const edgeBudget = options.groupImports ?? DEFAULT_LOD_BUDGET.groupImports;

  const clustering = clusterGraph(graph, SHUT);
  const reached = neighbourhoodOf(graph, changedPaths, 1);
  const open = openGroups(clustering.groups, changedPaths, reached, budget);

  const kept = new Set<string>();
  const summaries: GroupSummary[] = [];
  for (const group of clustering.groups) {
    if (open.has(group.id)) {
      for (const path of group.files) kept.add(path);
      continue;
    }
    const counts = sumHeat(heat, group.files);
    summaries.push({
      id: group.id,
      fileCount: group.fileCount,
      changedCount: group.changedCount,
      ...(group.impactedCount > 0 ? { impactedCount: group.impactedCount } : {}),
      ...(counts.total > 0 ? { heat: counts } : {}),
    });
  }

  const files = graph.files.filter((file) => kept.has(file.path));
  const imports = graph.imports.filter(
    (edge) => kept.has(edge.from) && kept.has(edge.to),
  );

  // Only the counts a summary node needs; edges between open groups are files here.
  const groupImports: GroupImport[] = clustering.imports
    .filter((edge) => !open.has(edge.from) || !open.has(edge.to))
    .sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : 1))
    .slice(0, Math.max(0, edgeBudget));

  return {
    files: files.map((file) => ({ ...file })),
    imports: imports.map((edge) => ({ ...edge })),
    truncated: graph.truncated,
    summaries,
    groupImports,
    totalFileCount: graph.files.length,
  };
}

/** Below the threshold the source is passed through untouched. */
export function mapPayload(source: MapSource, options: LodOptions = {}): MapPayload {
  const threshold = options.threshold ?? DEFAULT_LOD_THRESHOLD;
  if (!source.graph || source.graph.files.length <= threshold) {
    return {
      mode: "full",
      graph: source.graph ?? { files: [], imports: [] },
      heat: source.heat,
      changedPaths: source.changedPaths,
    };
  }

  const graph = normaliseGraph(source.graph);
  const lod = lodGraph(graph, source.changedPaths, source.heat, options);
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
}

export interface GroupSlice {
  groupId: string;
  graph: MapGraph;
  heat: FindingHeat;
}

/**
 * One group's files, the edges among them, and the edges to files the caller
 * already holds — so nothing arrives pointing at a file the map does not have.
 */
export function groupSlice(
  graph: NormalisedGraph,
  heat: FindingHeat,
  groupId: string,
  alreadyHeld: ReadonlySet<string> = new Set(),
): GroupSlice {
  const mine = new Set<string>();
  const files = graph.files.filter((file) => {
    if (groupIdFor(file) !== groupId) return false;
    mine.add(file.path);
    return true;
  });

  const reachable = (path: string) => mine.has(path) || alreadyHeld.has(path);
  const imports = graph.imports.filter(
    (edge) =>
      (mine.has(edge.from) || mine.has(edge.to)) &&
      reachable(edge.from) &&
      reachable(edge.to),
  );

  const slice: FindingHeat = {};
  for (const path of mine) {
    const counts = heat[path];
    if (counts) slice[path] = counts;
  }

  return {
    groupId,
    graph: { files: files.map((file) => ({ ...file })), imports: imports.map((e) => ({ ...e })) },
    heat: slice,
  };
}

/** Every path in the named groups — what a caller holding those groups has. */
export function pathsInGroups(
  graph: NormalisedGraph,
  groupIds: readonly string[],
): ReadonlySet<string> {
  const wanted = new Set(groupIds);
  const paths = new Set<string>();
  if (wanted.size === 0) return paths;
  for (const file of graph.files) {
    if (wanted.has(groupIdFor(file))) paths.add(file.path);
  }
  return paths;
}

export interface LodSearchResult extends SearchResult {
  groupId: string;
}

/** The same ranking the browser uses, run over the whole repo on the server. */
export function searchGroups(
  graph: NormalisedGraph,
  query: string,
  limit: number,
): LodSearchResult[] {
  return searchFiles(graph.files, query, limit).map((result) => {
    const file = graph.byPath.get(result.path);
    return { ...result, groupId: file ? groupIdFor(file) : "" };
  });
}
