import {
  baseName,
  clusterGraph,
  isImpacted,
  isTest,
  type Clustering,
  type MapGroup,
} from "@/lib/codebase-map/clustering";
import { cycleEdges, edgeKey } from "@/lib/codebase-map/cycles";
import { emphasise, EMPHASIS_MARKERS, groupLevel, type EmphasisLevel } from "@/lib/codebase-map/emphasis";
import type { FindingHeat } from "@/lib/codebase-map/from-snapshot";
import { heatOf, heatOfPaths, type Heat } from "@/lib/codebase-map/heat";
import { filePosition, groupCentre, layoutGroups, MAP_LAYOUT, type LayoutPoint } from "@/lib/codebase-map/layout";
import {
  DEFAULT_REACH,
  MAX_REACH,
  neighbourhood,
  reachOf,
  type NeighbourDirection,
  type Neighbourhood,
} from "@/lib/codebase-map/neighbourhood";
import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import type { ChangeStatus, MapFile, MapImport, MapViewState } from "@/lib/codebase-map/types";

type SceneNodeKind = "file" | "group";
type EdgeRelation = "base" | "cycle" | "dependency" | "dependent";

export interface SceneNode {
  id: string;
  kind: SceneNodeKind;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  radius: number;
  level: EmphasisLevel;
  marker: string;
  direction: NeighbourDirection | null;
  /** How the PR changes this file, when an overlay said so. */
  change: ChangeStatus | null;
  /** Import steps from the change, while the file is drawn as reached. */
  depth: number | null;
  /** True only when the index flagged it; unknown and clean both read false here. */
  dead: boolean;
  /** A test or fixture, drawn quieter than its level. */
  quiet: boolean;
  fileCount: number;
  changedCount: number;
  /** Zero while the impacted overlay is hidden. */
  impactedCount: number;
  reachedCount: number;
  heat: Heat;
}

interface SceneEdge {
  a: string;
  b: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  relation: EdgeRelation;
  change: MapImport["change"] | null;
}

export interface Scene {
  clustering: Clustering;
  nodes: readonly SceneNode[];
  edges: readonly SceneEdge[];
  byId: ReadonlyMap<string, SceneNode>;
  representativeOf: ReadonlyMap<string, string>;
  /** The focus's neighbourhood, so readers of the scene need not walk the graph again. */
  neighbourhood: Neighbourhood;
  /** The change's dependents within the chosen depth, summaries' counts included. */
  reach: { depth: number; files: ReadonlyMap<string, number>; count: number; byGroup: ReadonlyMap<string, number> };
  hiddenTests: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const FILE_RADIUS = 4;

const CHANGE_MARKERS: Record<ChangeStatus, string> = {
  added: "plus",
  modified: EMPHASIS_MARKERS.changed,
  removed: "cross",
  renamed: "filled-diamond",
};

const POSITIONS = new WeakMap<NormalisedGraph, Readonly<Record<string, LayoutPoint>>>();

// A graph with no pinned layout gets one from itself, once.
function groupPositionsOf(graph: NormalisedGraph): Readonly<Record<string, LayoutPoint>> {
  if (graph.groupPositions) return graph.groupPositions;
  let positions = POSITIONS.get(graph);
  if (!positions) {
    positions = layoutGroups(graph);
    POSITIONS.set(graph, positions);
  }
  return positions;
}

// The only place the hideImpacted overlay applies.
function impactOverlay(view: MapViewState) {
  const shown = view.hideImpacted !== true;
  return {
    file: (file: MapFile | undefined) => (shown && file !== undefined && isImpacted(file) ? 1 : 0),
    group: (group: MapGroup) => (shown ? group.impactedCount : 0),
  };
}

export function clampReach(depth: number | undefined): number {
  if (depth === undefined || !Number.isFinite(depth)) return DEFAULT_REACH;
  return Math.min(MAX_REACH, Math.max(1, Math.round(depth)));
}

// The walk over what is loaded, topped up by what the server walked over the whole repo.
function reachWithin(graph: NormalisedGraph, depth: number): Map<string, number> {
  const changed = graph.files.filter((file) => file.changed === true).map((file) => file.path);
  const files = new Map(reachOf(graph, changed, depth));
  for (const file of graph.files) {
    if (file.changed === true || file.reach === undefined || file.reach > depth) continue;
    files.set(file.path, Math.min(file.reach, files.get(file.path) ?? Infinity));
  }
  return files;
}

function markerOf(level: EmphasisLevel, change: ChangeStatus | null, depth: number | null): string {
  if (level === "changed" && change !== null) return CHANGE_MARKERS[change];
  if (level === "reached" && depth !== null) return `${EMPHASIS_MARKERS.reached}-${depth}`;
  return EMPHASIS_MARKERS[level];
}

export function buildScene(
  graph: NormalisedGraph,
  view: MapViewState,
  steps = 1,
  heat: FindingHeat = {},
): Scene {
  const positions = groupPositionsOf(graph);
  const clustering = clusterGraph(graph, view);
  const hood = neighbourhood(graph, view.focusedPath, steps);
  const impact = impactOverlay(view);
  const depth = clampReach(view.reachDepth);
  const reached = reachWithin(graph, depth);
  const reaching = hood.focus === null;
  const emphasis = emphasise(graph, view, hood, (file) => impact.file(file) > 0, reached);
  const summaryById = new Map(graph.summaries.map((summary) => [summary.id, summary]));
  const hideTests = view.hideTests === true;

  const nodes: SceneNode[] = [];
  const byId = new Map<string, SceneNode>();
  const representativeOf = new Map<string, string>();
  const byGroup = new Map<string, number>();
  let hiddenTests = 0;

  for (const group of clustering.groups) {
    const centre = positions[group.id] ?? groupCentre(group.id, MAP_LAYOUT);
    let groupReached = 0;
    for (const path of group.files) if (reached.has(path)) groupReached += 1;
    const summarised = summaryById.get(group.id)?.reachedByDepth ?? [];
    const serverCount = summarised.slice(0, depth).reduce((sum, count) => sum + count, 0);
    const reachedCount = Math.max(groupReached, serverCount);
    if (reachedCount > 0) byGroup.set(group.id, reachedCount);

    if (!group.collapsed) {
      for (const path of group.files) {
        const file = graph.byPath.get(path);
        const test = isTest(file);
        if (test && hideTests) {
          hiddenTests += 1;
          continue;
        }
        const point = filePosition(path, centre, MAP_LAYOUT.groupRadius);
        const level = emphasis.get(path)!;
        const change = file?.change ?? null;
        const fileDepth = level === "reached" ? (reached.get(path) ?? null) : null;
        const node: SceneNode = {
          id: path,
          kind: "file",
          label: baseName(path),
          sublabel: path,
          x: point.x,
          y: point.y,
          radius: FILE_RADIUS,
          level,
          marker: markerOf(level, change, fileDepth),
          direction: hood.dependencies.has(path)
            ? hood.dependents.has(path)
              ? "both"
              : "dependency"
            : hood.dependents.has(path)
              ? "dependent"
              : null,
          change,
          depth: fileDepth,
          dead: file?.dead === true,
          quiet: test,
          fileCount: 1,
          changedCount: file?.changed === true ? 1 : 0,
          impactedCount: impact.file(file),
          reachedCount: reached.has(path) ? 1 : 0,
          heat: heatOf(heat[path]),
        };
        nodes.push(node);
        byId.set(path, node);
        representativeOf.set(path, path);
      }
      continue;
    }

    for (const path of group.files) {
      if (hideTests && isTest(graph.byPath.get(path))) {
        hiddenTests += 1;
        continue;
      }
      representativeOf.set(path, group.id);
    }
    const impactedCount = impact.group(group);
    const node: SceneNode = {
      id: group.id,
      kind: "group",
      label: baseName(group.directory),
      sublabel: `${group.package ?? "no package"} · ${group.directory}`,
      x: centre.x,
      y: centre.y,
      radius: 7 + Math.sqrt(Math.max(1, group.fileCount)) * 1.6,
      level: groupLevel(
        group.files,
        emphasis,
        group.changedCount,
        impactedCount,
        reaching ? reachedCount : 0,
      ),
      // A collapsed group is structure, so it never borrows a file's marker.
      marker: "group",
      direction: null,
      change: null,
      depth: null,
      dead: false,
      quiet: false,
      fileCount: group.fileCount,
      changedCount: group.changedCount,
      impactedCount,
      reachedCount,
      heat: group.heatCounts ? heatOf(group.heatCounts) : heatOfPaths(heat, group.files),
    };
    nodes.push(node);
    byId.set(group.id, node);
  }

  const focus = hood.focus;
  const cycles = cycleEdges(graph);
  const seen = new Set<string>();
  const edges: SceneEdge[] = [];
  for (const edge of graph.imports) {
    const a = representativeOf.get(edge.from);
    const b = representativeOf.get(edge.to);
    if (a === undefined || b === undefined || a === b) continue;
    const between = a === edge.from && b === edge.to;
    // A removed edge means nothing once folded into a group's count.
    if (edge.change === "removed" && !between) continue;
    const relation: EdgeRelation =
      focus !== null && edge.from === focus
        ? "dependency"
        : focus !== null && edge.to === focus
          ? "dependent"
          : cycles.has(edgeKey(edge.from, edge.to))
            ? "cycle"
            : "base";
    const change = between ? (edge.change ?? null) : null;
    const key = `${a}\u0000${b}\u0000${relation}\u0000${change ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const from = byId.get(a)!;
    const to = byId.get(b)!;
    edges.push({ a, b, ax: from.x, ay: from.y, bx: to.x, by: to.y, relation, change });
  }

  // Summaries have no file edges of their own, so the group counts stand in.
  for (const edge of clustering.imports) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${edge.from}\u0000${edge.to}\u0000base\u0000`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      a: edge.from,
      b: edge.to,
      ax: from.x,
      ay: from.y,
      bx: to.x,
      by: to.y,
      relation: "base",
      change: null,
    });
  }

  const RELATION_ORDER: Record<EdgeRelation, number> = { base: 0, cycle: 1, dependent: 2, dependency: 3 };
  edges.sort((a, b) => RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation]);

  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const node of nodes) {
    if (node.x - node.radius < minX) minX = node.x - node.radius;
    if (node.y - node.radius < minY) minY = node.y - node.radius;
    if (node.x + node.radius > maxX) maxX = node.x + node.radius;
    if (node.y + node.radius > maxY) maxY = node.y + node.radius;
  }

  let count = 0;
  for (const value of byGroup.values()) count += value;

  return {
    clustering,
    nodes,
    edges,
    byId,
    representativeOf,
    neighbourhood: hood,
    reach: { depth, files: reached, count, byGroup },
    hiddenTests,
    bounds: { minX, minY, maxX, maxY },
  };
}
