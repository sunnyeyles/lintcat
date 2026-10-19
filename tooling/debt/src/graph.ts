import type { Workspace, WorkspaceKind } from "#src/workspaces";

interface GraphNode {
  dir: string;
  kind: WorkspaceKind;
  dependencies: string[];
  dependents: string[];
  layer: number;
  exports: string[];
}

export interface Graph {
  nodes: Record<string, GraphNode>;
  cycles: string[][];
}

export function buildGraph(workspaces: Workspace[]): Graph {
  const known = new Set(workspaces.map((w) => w.name));
  const nodes: Record<string, GraphNode> = {};
  for (const w of workspaces) {
    nodes[w.name] = {
      dir: w.dir,
      kind: w.kind,
      dependencies: w.dependencies.filter((d) => known.has(d)),
      dependents: [],
      layer: 0,
      exports: w.exports,
    };
  }
  for (const [name, node] of Object.entries(nodes)) {
    for (const dep of node.dependencies) nodes[dep]?.dependents.push(name);
  }
  for (const node of Object.values(nodes)) node.dependents.sort();

  const cycles = findCycles(nodes);
  const onCycle = new Set(cycles.flat());
  const layerOf = new Map<string, number>();
  const layer = (name: string, seen: Set<string>): number => {
    const cached = layerOf.get(name);
    if (cached !== undefined) return cached;
    if (seen.has(name) || onCycle.has(name)) return 0;
    seen.add(name);
    const deps = nodes[name]?.dependencies ?? [];
    const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => layer(d, seen)));
    layerOf.set(name, value);
    return value;
  };
  for (const name of Object.keys(nodes)) nodes[name]!.layer = layer(name, new Set());
  return { nodes, cycles };
}

function findCycles(nodes: Record<string, GraphNode>): string[][] {
  const cycles: string[][] = [];
  const seenCycle = new Set<string>();
  const state = new Map<string, "open" | "done">();
  const stack: string[] = [];
  const visit = (name: string) => {
    const s = state.get(name);
    if (s === "done") return;
    if (s === "open") {
      const cycle = stack.slice(stack.indexOf(name));
      const key = [...cycle].sort().join("|");
      if (!seenCycle.has(key)) {
        seenCycle.add(key);
        cycles.push(cycle);
      }
      return;
    }
    state.set(name, "open");
    stack.push(name);
    for (const dep of nodes[name]?.dependencies ?? []) visit(dep);
    stack.pop();
    state.set(name, "done");
  };
  for (const name of Object.keys(nodes).sort()) visit(name);
  return cycles;
}

export function transitiveDependents(graph: Graph, names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const queue = [...names];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (out.has(name)) continue;
    out.add(name);
    queue.push(...(graph.nodes[name]?.dependents ?? []));
  }
  return out;
}

// Tooling stays outside the product graph: it may depend only on the allow-listed packages.
export function isolationViolations(graph: Graph, allowed: string[]): string[] {
  const out: string[] = [];
  for (const [name, node] of Object.entries(graph.nodes)) {
    if (node.kind !== "tooling") continue;
    for (const dep of node.dependencies) {
      if (graph.nodes[dep]?.kind !== "tooling" && !allowed.includes(dep)) out.push(`${name} -> ${dep}`);
    }
  }
  return out.sort();
}

export function packageForFile(graph: Graph, file: string): string | null {
  let best: string | null = null;
  for (const [name, node] of Object.entries(graph.nodes)) {
    if (file === node.dir || file.startsWith(`${node.dir}/`)) {
      if (best === null || node.dir.length > graph.nodes[best]!.dir.length) best = name;
    }
  }
  return best;
}
