import { CLOSED_VIEW, clusterGraph, groupIdFor, type MapGroup } from "@/lib/codebase-map/clustering";
import type { FindingHeat } from "@/lib/codebase-map/from-snapshot";
import { sumHeat } from "@/lib/codebase-map/heat";
import { groupLayout, MAP_LAYOUT } from "@/lib/codebase-map/layout";
import { MAX_REACH, neighbourhoodOf, reachOf } from "@/lib/codebase-map/neighbourhood";
import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import { searchFiles, type SearchResult } from "@/lib/codebase-map/search";
import type {
  GroupImport,
  GroupSummary,
  LayoutPoint,
  MapFile,
  MapGraph,
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

/** Env wins over the default; an option wins over both. */
export function resolveLodThreshold(raw: string | undefined, override?: number): number {
  if (override !== undefined && Number.isFinite(override)) return Math.max(0, override);
  const parsed = Number(raw);
  if (raw !== undefined && raw.trim() !== "" && Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed);
  }
  return DEFAULT_LOD_THRESHOLD;
}

interface Opening {
  open: ReadonlySet<string>;
  /** Groups too big for the budget: only their changed and reached files go. */
  partial: ReadonlyMap<string, readonly string[]>;
}

/**
 * Groups worth sending: the ones holding a changed file first, then the ones
 * a change reaches in one step. One too big for what is left goes partial.
 */
function openGroups(
  groups: readonly MapGroup[],
  changedPaths: readonly string[],
  touching: ReadonlySet<string>,
  reach: ReadonlyMap<string, number>,
  budget: number,
): Opening {
  const changedSet = new Set(changedPaths);
  const scored = groups.map((group) => {
    let changed = 0;
    let touched = 0;
    for (const path of group.files) {
      if (changedSet.has(path)) changed += 1;
      if (touching.has(path)) touched += 1;
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
  const partial = new Map<string, string[]>();
  let spent = 0;
  for (const { group, changed, touched } of scored) {
    if (changed === 0 && touched === 0) break;
    if (spent + group.files.length <= budget) {
      open.add(group.id);
      spent += group.files.length;
      continue;
    }
    // Changed files always ship, budget or not; reached ones only while it lasts.
    const taken = group.files.filter((path) => changedSet.has(path));
    spent += taken.length;
    const reached = group.files
      .filter((path) => !changedSet.has(path) && reach.has(path))
      .sort((a, b) => reach.get(a)! - reach.get(b)! || (a < b ? -1 : 1));
    for (const path of reached) {
      if (spent >= budget) break;
      taken.push(path);
      spent += 1;
    }
    if (taken.length === group.files.length) open.add(group.id);
    else if (taken.length > 0) partial.set(group.id, taken);
  }
  return { open, partial };
}

function reachedByDepth(files: readonly string[], reach: ReadonlyMap<string, number>): number[] {
  const counts = Array.from({ length: MAX_REACH }, () => 0);
  for (const path of files) {
    const depth = reach.get(path);
    if (depth !== undefined) counts[depth - 1]! += 1;
  }
  return counts;
}

/** Shipped files carry the server's walk, since the client cannot see past what it holds. */
function withReach(file: MapFile, reach: ReadonlyMap<string, number>): MapFile {
  const depth = reach.get(file.path);
  return depth === undefined ? { ...file } : { ...file, reach: depth };
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

  const clustering = clusterGraph(graph, CLOSED_VIEW);
  const touching = neighbourhoodOf(graph, changedPaths, 1);
  const reach = reachOf(graph, changedPaths, MAX_REACH);
  const { open, partial } = openGroups(clustering.groups, changedPaths, touching, reach, budget);

  const positions = groupLayout(
    clustering.groups.map((group) => group.id),
    clustering.imports,
    MAP_LAYOUT,
  );
  const openPositions: Record<string, LayoutPoint> = {};

  const kept = new Set<string>();
  const summaries: GroupSummary[] = [];
  for (const group of clustering.groups) {
    const point = positions[group.id]!;
    if (open.has(group.id)) {
      for (const path of group.files) kept.add(path);
      openPositions[group.id] = point;
      continue;
    }
    for (const path of partial.get(group.id) ?? []) kept.add(path);
    const counts = sumHeat(heat, group.files);
    const depths = reachedByDepth(group.files, reach);
    summaries.push({
      id: group.id,
      fileCount: group.fileCount,
      changedCount: group.changedCount,
      ...(group.impactedCount > 0 ? { impactedCount: group.impactedCount } : {}),
      ...(depths.some((count) => count > 0) ? { reachedByDepth: depths } : {}),
      ...(counts.total > 0 ? { heat: counts } : {}),
      at: [point.x, point.y],
    });
  }

  const files = graph.files.filter((file) => kept.has(file.path));
  const imports = graph.imports.filter(
    (edge) => kept.has(edge.from) && kept.has(edge.to),
  );

  // Only the counts a summary node needs; edges between open groups are files here.
  const wanted = clustering.imports
    .filter((edge) => !open.has(edge.from) || !open.has(edge.to))
    .sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : 1));
  const groupImports: GroupImport[] = wanted.slice(0, Math.max(0, edgeBudget));

  return {
    files: files.map((file) => withReach(file, reach)),
    imports: imports.map((edge) => ({ ...edge })),
    truncated: graph.truncated,
    summaries,
    groupImports,
    ...(wanted.length > groupImports.length
      ? { groupImportsDropped: wanted.length - groupImports.length }
      : {}),
    totalFileCount: graph.files.length,
    ...(graph.overlay === undefined ? {} : { overlay: graph.overlay }),
    ...(graph.unresolvedImportCount === undefined
      ? {}
      : { unresolvedImportCount: graph.unresolvedImportCount }),
    groupPositions: openPositions,
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
  reach: ReadonlyMap<string, number> = new Map(),
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
    graph: {
      files: files.map((file) => withReach(file, reach)),
      imports: imports.map((e) => ({ ...e })),
    },
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
