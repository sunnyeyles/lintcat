import {
  clusterGraph,
  emphasise,
  EMPHASIS_RANK,
  heatOf,
  heatOfPaths,
  groupCentre,
  neighbourhood,
  seedLayout,
} from "@/lib/codebase-map";
import type {
  Clustering,
  EmphasisLevel,
  FindingHeat,
  Heat,
  MapViewState,
  NeighbourDirection,
  NormalisedGraph,
} from "@/lib/codebase-map";

type SceneNodeKind = "file" | "group";
type EdgeRelation = "base" | "dependency" | "dependent";

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
  fileCount: number;
  changedCount: number;
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
}

export interface Scene {
  clustering: Clustering;
  nodes: readonly SceneNode[];
  edges: readonly SceneEdge[];
  byId: ReadonlyMap<string, SceneNode>;
  representativeOf: ReadonlyMap<string, string>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const FILE_RADIUS = 4;

/** Wider than the module's default so groups read as separate islands rather than one hairball. */
const LAYOUT = { mapRadius: 3600, groupRadius: 150 } as const;

function fileNameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

function lastSegment(directory: string): string {
  const cut = directory.lastIndexOf("/");
  return cut === -1 ? directory : directory.slice(cut + 1);
}

function lowerRank(a: EmphasisLevel, b: EmphasisLevel): EmphasisLevel {
  return EMPHASIS_RANK[a] <= EMPHASIS_RANK[b] ? a : b;
}

export function buildScene(
  graph: NormalisedGraph,
  view: MapViewState,
  steps = 1,
  heat: FindingHeat = {},
): Scene {
  const positions = seedLayout(graph, LAYOUT);
  const clustering = clusterGraph(graph, view);
  const emphasis = emphasise(graph, view, steps);
  const hood = neighbourhood(graph, view.focusedPath, steps);

  const nodes: SceneNode[] = [];
  const byId = new Map<string, SceneNode>();
  const representativeOf = new Map<string, string>();

  for (const group of clustering.groups) {
    if (!group.collapsed) {
      for (const path of group.files) {
        const point = positions.get(path)!;
        const mark = emphasis.get(path)!;
        const node: SceneNode = {
          id: path,
          kind: "file",
          label: fileNameOf(path),
          sublabel: path,
          x: point.x,
          y: point.y,
          radius: FILE_RADIUS,
          level: mark.level,
          marker: mark.marker,
          direction: hood.dependencies.has(path)
            ? hood.dependents.has(path)
              ? "both"
              : "dependency"
            : hood.dependents.has(path)
              ? "dependent"
              : null,
          fileCount: 1,
          changedCount: graph.byPath.get(path)?.changed === true ? 1 : 0,
          heat: heatOf(heat[path]),
        };
        nodes.push(node);
        byId.set(path, node);
        representativeOf.set(path, path);
      }
      continue;
    }

    let x = 0;
    let y = 0;
    let level: EmphasisLevel = "dimmed";
    for (const path of group.files) {
      const point = positions.get(path)!;
      x += point.x;
      y += point.y;
      level = lowerRank(level, emphasis.get(path)!.level);
      representativeOf.set(path, group.id);
    }
    // A summary has no files to average, so it sits on its group's own seed.
    const empty = group.files.length === 0;
    const centre = empty
      ? groupCentre(group.id, LAYOUT)
      : { x: x / group.files.length, y: y / group.files.length };
    if (empty) level = group.changedCount > 0 ? "changed" : "context";
    const node: SceneNode = {
      id: group.id,
      kind: "group",
      label: lastSegment(group.directory),
      sublabel: `${group.package ?? "no package"} · ${group.directory}`,
      x: centre.x,
      y: centre.y,
      radius: 7 + Math.sqrt(Math.max(1, group.fileCount)) * 1.6,
      level,
      // A collapsed group is structure, so it never borrows a file's marker.
      marker: "group",
      direction: null,
      fileCount: group.fileCount,
      changedCount: group.changedCount,
      heat: group.heatCounts ? heatOf(group.heatCounts) : heatOfPaths(heat, group.files),
    };
    nodes.push(node);
    byId.set(group.id, node);
  }

  const focus = hood.focus;
  const seen = new Set<string>();
  const edges: SceneEdge[] = [];
  for (const edge of graph.imports) {
    const a = representativeOf.get(edge.from);
    const b = representativeOf.get(edge.to);
    if (a === undefined || b === undefined || a === b) continue;
    const relation: EdgeRelation =
      focus === null
        ? "base"
        : edge.from === focus
          ? "dependency"
          : edge.to === focus
            ? "dependent"
            : "base";
    const key = `${a}\u0000${b}\u0000${relation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const from = byId.get(a)!;
    const to = byId.get(b)!;
    edges.push({ a, b, ax: from.x, ay: from.y, bx: to.x, by: to.y, relation });
  }

  // Summaries have no file edges of their own, so the group counts stand in.
  for (const edge of clustering.imports) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${edge.from}\u0000${edge.to}\u0000base`;
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
    });
  }

  const RELATION_ORDER: Record<EdgeRelation, number> = { base: 0, dependent: 1, dependency: 2 };
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

  return {
    clustering,
    nodes,
    edges,
    byId,
    representativeOf,
    bounds: { minX, minY, maxX, maxY },
  };
}
