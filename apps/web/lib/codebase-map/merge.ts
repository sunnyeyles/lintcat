import { normaliseGraph } from "@/lib/codebase-map/normalise";
import type { MapGraph } from "@/lib/codebase-map/types";

// Normalising does the merge: a file already held keeps its flags, the arrival only fills blanks.
export function expandGroup(base: MapGraph, groupId: string, slice: MapGraph): MapGraph {
  const merged = normaliseGraph({
    ...base,
    files: [...base.files, ...(slice.files ?? [])],
    imports: [...base.imports, ...(slice.imports ?? [])],
  });
  const next: MapGraph = { ...base, files: [...merged.files], imports: [...merged.imports] };
  if (base.summaries) {
    next.summaries = merged.summaries.filter((summary) => summary.id !== groupId);
  }
  return next;
}
