import type { NormalisedGraph } from "@/lib/codebase-map/normalise";

const CACHE = new WeakMap<NormalisedGraph, ReadonlySet<string>>();

export function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/** Edges that close an import cycle: both ends flagged, and each reaches the other. */
export function cycleEdges(graph: NormalisedGraph): ReadonlySet<string> {
  const cached = CACHE.get(graph);
  if (cached) return cached;
  const component = components(graph);
  const edges = new Set<string>();
  for (const edge of graph.imports) {
    if (edge.change === "removed") continue;
    if (graph.byPath.get(edge.from)?.inCycle !== true) continue;
    if (graph.byPath.get(edge.to)?.inCycle !== true) continue;
    if (component.get(edge.from) === component.get(edge.to)) edges.add(edgeKey(edge.from, edge.to));
  }
  CACHE.set(graph, edges);
  return edges;
}

// Tarjan's strongly connected components, iterative so a long chain cannot overflow the stack.
function components(graph: NormalisedGraph): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const component = new Map<string, number>();
  let counter = 0;
  let found = 0;

  for (const root of graph.byPath.keys()) {
    if (index.has(root)) continue;
    const work: { path: string; next: number }[] = [{ path: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const targets = graph.outgoing.get(frame.path) ?? [];
      if (frame.next < targets.length) {
        const target = targets[frame.next]!;
        frame.next += 1;
        if (!index.has(target)) {
          index.set(target, counter);
          low.set(target, counter);
          counter += 1;
          stack.push(target);
          onStack.add(target);
          work.push({ path: target, next: 0 });
        } else if (onStack.has(target)) {
          low.set(frame.path, Math.min(low.get(frame.path)!, index.get(target)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.path, Math.min(low.get(parent.path)!, low.get(frame.path)!));
      if (low.get(frame.path) === index.get(frame.path)) {
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.set(member, found);
        } while (member !== frame.path);
        found += 1;
      }
    }
  }
  return component;
}
