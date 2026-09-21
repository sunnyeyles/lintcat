/**
 * Import cycles: the strongly connected components of the resolved graph,
 * by Tarjan's algorithm kept iterative so a deep tree cannot blow the stack.
 */

interface NumberedGraph {
  readonly names: readonly string[];
  readonly successors: readonly (readonly number[])[];
}

/** Numbers every node so the search can run over typed arrays. */
function number(graph: ReadonlyMap<string, readonly string[]>): NumberedGraph {
  const ids = new Map<string, number>();
  const names: string[] = [];
  const idOf = (name: string): number => {
    const known = ids.get(name);
    if (known !== undefined) {
      return known;
    }
    ids.set(name, names.length);
    names.push(name);
    return names.length - 1;
  };

  const successors: number[][] = [];
  for (const [from, targets] of graph) {
    const id = idOf(from);
    while (successors.length <= id) {
      successors.push([]);
    }
    for (const target of targets) {
      const to = idOf(target);
      while (successors.length <= to) {
        successors.push([]);
      }
      successors[id]!.push(to);
    }
  }
  return { names, successors };
}

/**
 * Every node belonging to a component of more than one node. A self-loop
 * leaves a node alone in its component, so it is not a cycle here.
 */
export function nodesInCycles(
  graph: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const { names, successors } = number(graph);
  const count = names.length;
  const order = new Int32Array(count).fill(-1);
  const low = new Int32Array(count);
  const onStack = new Uint8Array(count);
  const component: number[] = [];
  const members = new Set<string>();
  let next = 0;

  const frames: number[] = [];
  const cursors: number[] = [];
  for (let root = 0; root < count; root += 1) {
    if (order[root] !== -1) {
      continue;
    }
    order[root] = next;
    low[root] = next;
    next += 1;
    component.push(root);
    onStack[root] = 1;
    frames.push(root);
    cursors.push(0);

    while (frames.length > 0) {
      const node = frames[frames.length - 1]!;
      const edges = successors[node] ?? [];
      const at = cursors[cursors.length - 1]!;
      if (at < edges.length) {
        cursors[cursors.length - 1] = at + 1;
        const to = edges[at]!;
        if (order[to] === -1) {
          order[to] = next;
          low[to] = next;
          next += 1;
          component.push(to);
          onStack[to] = 1;
          frames.push(to);
          cursors.push(0);
        } else if (onStack[to] === 1) {
          low[node] = Math.min(low[node]!, order[to]!);
        }
        continue;
      }

      frames.pop();
      cursors.pop();
      const parent = frames[frames.length - 1];
      if (parent !== undefined) {
        low[parent] = Math.min(low[parent]!, low[node]!);
      }
      if (low[node] !== order[node]) {
        continue;
      }
      const found: number[] = [];
      for (;;) {
        const popped = component.pop()!;
        onStack[popped] = 0;
        found.push(popped);
        if (popped === node) {
          break;
        }
      }
      if (found.length > 1) {
        for (const member of found) {
          members.add(names[member]!);
        }
      }
    }
  }
  return members;
}
