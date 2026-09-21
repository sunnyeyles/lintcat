// The "what to show" half of the codebase map (issue #145). Pure: no DOM, no fetching.

export type FileKind = "source" | "test" | "config" | "docs";

export type MapNode = {
  id: string;
  kind: FileKind;
  size: number;
  changed?: boolean;
  dead?: boolean;
  cycle?: boolean;
};

export type MapEdge = { from: string; to: string };

export type MapGraph = { nodes: MapNode[]; edges: MapEdge[] };

export type Highlight = "changed" | "dependencies" | "dependents" | "none";

export type MapView = {
  highlight: Highlight;
  kinds: ReadonlySet<FileKind>;
  showDead: boolean;
  showCycles: boolean;
  query: string;
  focus: string | null;
};

export type NodeState = "focus" | "emphasis" | "normal" | "dim" | "hidden";

export const DEFAULT_VIEW: MapView = {
  highlight: "changed",
  kinds: new Set<FileKind>(["source", "test", "config", "docs"]),
  showDead: true,
  showCycles: true,
  query: "",
  focus: null,
};

export function clusterOf(id: string): string {
  const parts = id.split("/");
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? id);
}

export function neighbours(graph: MapGraph, id: string): { imports: string[]; importedBy: string[] } {
  const imports = graph.edges.filter((e) => e.from === id).map((e) => e.to);
  const importedBy = graph.edges.filter((e) => e.to === id).map((e) => e.from);
  return { imports, importedBy };
}

function passesFilters(node: MapNode, view: MapView): boolean {
  if (!view.kinds.has(node.kind)) return false;
  if (node.dead && !view.showDead) return false;
  if (view.query && !node.id.toLowerCase().includes(view.query.toLowerCase())) return false;
  return true;
}

// Emphasis is a set; the focused file's neighbourhood wins over the mode when a focus is set.
function emphasised(graph: MapGraph, view: MapView): Set<string> {
  if (view.focus) {
    const { imports, importedBy } = neighbours(graph, view.focus);
    if (view.highlight === "dependencies") return new Set(imports);
    if (view.highlight === "dependents") return new Set(importedBy);
    return new Set([...imports, ...importedBy]);
  }
  if (view.highlight === "changed") {
    return new Set(graph.nodes.filter((n) => n.changed).map((n) => n.id));
  }
  return new Set();
}

export function classify(graph: MapGraph, view: MapView): Map<string, NodeState> {
  const bright = emphasised(graph, view);
  const anyEmphasis = bright.size > 0 || view.focus !== null;
  const states = new Map<string, NodeState>();
  for (const node of graph.nodes) {
    if (!passesFilters(node, view)) states.set(node.id, "hidden");
    else if (node.id === view.focus) states.set(node.id, "focus");
    else if (bright.has(node.id)) states.set(node.id, "emphasis");
    else states.set(node.id, anyEmphasis ? "dim" : "normal");
  }
  return states;
}

export type EdgeState = "emphasis" | "normal" | "dim" | "hidden";

export function classifyEdges(graph: MapGraph, nodes: Map<string, NodeState>, view: MapView): EdgeState[] {
  return graph.edges.map((edge) => {
    const a = nodes.get(edge.from) ?? "hidden";
    const b = nodes.get(edge.to) ?? "hidden";
    if (a === "hidden" || b === "hidden") return "hidden";
    if (view.focus && (edge.from === view.focus || edge.to === view.focus)) {
      return a === "dim" || b === "dim" ? "dim" : "emphasis";
    }
    if (a === "emphasis" && b === "emphasis") return "emphasis";
    if (a === "dim" || b === "dim") return "dim";
    return "normal";
  });
}

export type MapStats = { files: number; changed: number; edges: number; cycles: number; dead: number };

export function stats(graph: MapGraph): MapStats {
  return {
    files: graph.nodes.length,
    changed: graph.nodes.filter((n) => n.changed).length,
    edges: graph.edges.length,
    cycles: graph.nodes.filter((n) => n.cycle).length,
    dead: graph.nodes.filter((n) => n.dead).length,
  };
}

export type Point = { x: number; y: number };
export type Cluster = { id: string; centre: Point; radius: number; members: string[] };
export type Layout = { positions: Map<string, Point>; clusters: Cluster[] };

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Clusters sit on a ring; members spiral out from each centre. Deterministic, so the map is stable.
export function layout(graph: MapGraph, width: number, height: number): Layout {
  const groups = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const key = clusterOf(node.id);
    groups.set(key, [...(groups.get(key) ?? []), node.id]);
  }
  const ids = [...groups.keys()].sort();
  const centre = { x: width / 2, y: height / 2 };
  const ring = Math.min(width, height) * 0.34;
  const positions = new Map<string, Point>();
  const clusters: Cluster[] = ids.map((id, index) => {
    const members = groups.get(id) ?? [];
    const angle = (index / ids.length) * Math.PI * 2 - Math.PI / 2;
    const c = ids.length === 1 ? centre : { x: centre.x + Math.cos(angle) * ring, y: centre.y + Math.sin(angle) * ring };
    const spread = 9 + Math.sqrt(members.length) * 8;
    members.forEach((member, i) => {
      const r = spread * Math.sqrt((i + 0.5) / members.length);
      const theta = i * GOLDEN_ANGLE;
      positions.set(member, { x: c.x + Math.cos(theta) * r, y: c.y + Math.sin(theta) * r });
    });
    return { id, centre: c, radius: spread + 14, members };
  });
  return { positions, clusters };
}

export type Rect = { x: number; y: number; width: number; height: number };
export type TreemapCell = Rect & { id: string };
export type TreemapGroup = Rect & { id: string; cells: TreemapCell[] };

// Squarified treemap: rows of near-square tiles, laid along the shorter side.
function squarify(items: { id: string; weight: number }[], rect: Rect): TreemapCell[] {
  const total = items.reduce((s, i) => s + i.weight, 0);
  if (total <= 0 || items.length === 0) return [];
  const sorted = [...items].sort((a, b) => b.weight - a.weight);
  const cells: TreemapCell[] = [];
  let { x, y, width, height } = rect;
  let row: { id: string; weight: number }[] = [];
  const scale = (width * height) / total;
  const worst = (r: typeof row, side: number) => {
    const s = r.reduce((sum, i) => sum + i.weight * scale, 0);
    const max = Math.max(...r.map((i) => i.weight * scale));
    const min = Math.min(...r.map((i) => i.weight * scale));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const flush = () => {
    const side = Math.min(width, height);
    const area = row.reduce((s, i) => s + i.weight * scale, 0);
    const thickness = side === 0 ? 0 : area / side;
    let offset = 0;
    for (const item of row) {
      const length = (item.weight * scale) / (thickness || 1);
      cells.push(
        width >= height
          ? { id: item.id, x, y: y + offset, width: thickness, height: length }
          : { id: item.id, x: x + offset, y, width: length, height: thickness },
      );
      offset += length;
    }
    if (width >= height) {
      x += thickness;
      width -= thickness;
    } else {
      y += thickness;
      height -= thickness;
    }
    row = [];
  };
  for (const item of sorted) {
    const side = Math.min(width, height);
    if (row.length && worst([...row, item], side) > worst(row, side)) flush();
    row.push(item);
  }
  if (row.length) flush();
  return cells;
}

export function treemapLayout(graph: MapGraph, width: number, height: number, gutter = 4): TreemapGroup[] {
  const groups = new Map<string, MapNode[]>();
  for (const node of graph.nodes) {
    const key = clusterOf(node.id);
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const outer = squarify(
    [...groups.entries()].map(([id, nodes]) => ({ id, weight: nodes.reduce((s, n) => s + n.size, 0) })),
    { x: 0, y: 0, width, height },
  );
  return outer.map((group) => {
    const inner: Rect = {
      x: group.x + gutter,
      y: group.y + gutter + 14,
      width: Math.max(0, group.width - gutter * 2),
      height: Math.max(0, group.height - gutter * 2 - 14),
    };
    const nodes = groups.get(group.id) ?? [];
    const cells = squarify(nodes.map((n) => ({ id: n.id, weight: n.size })), inner).map((c) => ({
      ...c,
      width: Math.max(0, c.width - 2),
      height: Math.max(0, c.height - 2),
    }));
    return { ...group, cells };
  });
}

export type ArcLayout = { positions: Map<string, number>; groups: { id: string; from: number; to: number }[] };

// Files on one axis, grouped by cluster, so imports read as arcs between neighbourhoods.
export function arcLayout(graph: MapGraph, width: number, padding = 16): ArcLayout {
  const ordered = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const step = ordered.length > 1 ? (width - padding * 2) / (ordered.length - 1) : 0;
  const positions = new Map<string, number>();
  const groups: ArcLayout["groups"] = [];
  ordered.forEach((node, i) => {
    const x = padding + i * step;
    positions.set(node.id, x);
    const cluster = clusterOf(node.id);
    const last = groups[groups.length - 1];
    if (last && last.id === cluster) last.to = x;
    else groups.push({ id: cluster, from: x, to: x });
  });
  return { positions, groups };
}
