import { groupIdFor } from "@/lib/codebase-map/clustering";
import type { NormalisedGraph } from "@/lib/codebase-map/normalise";

export type NavigationAxis = "dependencies" | "dependents" | "siblings";
export type NavigationStep = "next" | "previous";

function siblingsOf(graph: NormalisedGraph, from: string): string[] {
  const file = graph.byPath.get(from);
  if (!file) return [];
  const id = groupIdFor(file);
  return graph.files.filter((other) => groupIdFor(other) === id).map((other) => other.path);
}

export function navigationCandidates(
  graph: NormalisedGraph,
  from: string | null,
  axis: NavigationAxis,
): readonly string[] {
  if (!from || !graph.byPath.has(from)) return [];
  if (axis === "dependencies") return graph.outgoing.get(from) ?? [];
  if (axis === "dependents") return graph.incoming.get(from) ?? [];
  return siblingsOf(graph, from);
}

export function navigate(
  graph: NormalisedGraph,
  from: string | null,
  axis: NavigationAxis,
  step: NavigationStep = "next",
): string | null {
  const candidates = navigationCandidates(graph, from, axis);
  if (candidates.length === 0) return null;

  if (candidates.length === 1 && candidates[0] === from) return null;

  const at = from === null ? -1 : candidates.indexOf(from);
  if (at === -1) return step === "next" ? candidates[0]! : candidates[candidates.length - 1]!;

  const offset = step === "next" ? 1 : candidates.length - 1;
  return candidates[(at + offset) % candidates.length]!;
}
