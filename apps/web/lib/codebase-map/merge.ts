import { groupIdFor } from "@/lib/codebase-map/clustering";
import type { MapFile, MapGraph } from "@/lib/codebase-map/types";

const FLAG_KEYS = ["role", "package", "changed", "dead", "inCycle"] as const;

// A file already in the map keeps its flags; the arrival may only fill blanks.
function fill(held: MapFile, arriving: MapFile): MapFile {
  let next: MapFile | undefined;
  for (const key of FLAG_KEYS) {
    if (held[key] === undefined && arriving[key] !== undefined) {
      next ??= { ...held };
      Object.assign(next, { [key]: arriving[key] });
    }
  }
  return next ?? held;
}

/**
 * Folds a fetched slice into the map already on screen. Running it twice with
 * the same slice changes nothing.
 */
export function mergeGraphs(base: MapGraph, extra: MapGraph): MapGraph {
  const files = [...base.files];
  const indexOf = new Map(base.files.map((file, i) => [file.path, i]));
  for (const file of extra.files ?? []) {
    const at = indexOf.get(file.path);
    if (at === undefined) {
      indexOf.set(file.path, files.length);
      files.push(file);
      continue;
    }
    files[at] = fill(files[at]!, file);
  }

  const imports = [...base.imports];
  const seen = new Set(base.imports.map((edge) => `${edge.from}\u0000${edge.to}`));
  for (const edge of extra.imports ?? []) {
    const key = `${edge.from}\u0000${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    imports.push(edge);
  }

  const held = new Map<string, number>();
  for (const file of files) {
    const id = groupIdFor(file);
    held.set(id, (held.get(id) ?? 0) + 1);
  }
  const summaries = (base.summaries ?? []).filter(
    (summary) => summary.fileCount > (held.get(summary.id) ?? 0),
  );

  const next: MapGraph = { ...base, files, imports };
  if (base.summaries) next.summaries = summaries;
  return next;
}

/** Merges one group's files and edges in, and retires its summary. */
export function expandGroup(base: MapGraph, groupId: string, slice: MapGraph): MapGraph {
  const merged = mergeGraphs(base, slice);
  if (!merged.summaries) return merged;
  return {
    ...merged,
    summaries: merged.summaries.filter((summary) => summary.id !== groupId),
  };
}
