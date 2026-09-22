import type { NormalisedGraph } from "@/lib/codebase-map/normalise";

export type NeighbourDirection = "dependency" | "dependent" | "both";

interface Neighbour {
  path: string;
  depth: number;
  direction: NeighbourDirection;
}

export interface Neighbourhood {
  focus: string | null;
  steps: number;
  dependencies: ReadonlyMap<string, number>;
  dependents: ReadonlyMap<string, number>;
  neighbours: readonly Neighbour[];
}

const EMPTY: Neighbourhood = {
  focus: null,
  steps: 0,
  dependencies: new Map(),
  dependents: new Map(),
  neighbours: [],
};

function walk(
  edges: ReadonlyMap<string, readonly string[]>,
  focus: string,
  steps: number,
): Map<string, number> {
  const depths = new Map<string, number>();
  let frontier = [focus];
  for (let depth = 1; depth <= steps && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const other of edges.get(path) ?? []) {
        if (other === focus || depths.has(other)) continue;
        depths.set(other, depth);
        next.push(other);
      }
    }
    frontier = next;
  }
  return depths;
}

/**
 * The union of several files and everything within `steps` of any of them —
 * what the map must have in view to show where a change lands.
 */
export function neighbourhoodOf(
  graph: NormalisedGraph,
  focuses: readonly string[],
  steps = 1,
): ReadonlySet<string> {
  const seen = new Set<string>();
  let frontier: string[] = [];
  for (const path of focuses) {
    if (!graph.byPath.has(path) || seen.has(path)) continue;
    seen.add(path);
    frontier.push(path);
  }
  for (let depth = 1; depth <= steps && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const path of frontier) {
      for (const edges of [graph.outgoing, graph.incoming]) {
        for (const other of edges.get(path) ?? []) {
          if (seen.has(other)) continue;
          seen.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

export function neighbourhood(
  graph: NormalisedGraph,
  focus: string | null,
  steps = 1,
): Neighbourhood {
  if (!focus || !graph.byPath.has(focus) || steps < 1) return EMPTY;

  const dependencies = walk(graph.outgoing, focus, steps);
  const dependents = walk(graph.incoming, focus, steps);

  const neighbours: Neighbour[] = [];
  for (const path of new Set([...dependencies.keys(), ...dependents.keys()])) {
    const out = dependencies.get(path);
    const back = dependents.get(path);
    const direction: NeighbourDirection =
      out !== undefined && back !== undefined ? "both" : out !== undefined ? "dependency" : "dependent";
    neighbours.push({ path, depth: Math.min(out ?? Infinity, back ?? Infinity), direction });
  }
  neighbours.sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return { focus, steps, dependencies, dependents, neighbours };
}
