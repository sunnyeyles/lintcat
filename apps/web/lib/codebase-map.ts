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
