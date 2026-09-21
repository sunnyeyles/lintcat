import { groupIdFor } from "@/lib/codebase-map/clustering";
import type {
  GroupImport,
  GroupSummary,
  MapFile,
  MapGraph,
  MapImport,
} from "@/lib/codebase-map/types";

export interface DroppedCounts {
  invalidFiles: number;
  duplicateFiles: number;
  duplicateImports: number;
  selfImports: number;
  unresolvedImports: number;
}

export interface NormalisedGraph {
  files: readonly MapFile[];
  imports: readonly MapImport[];
  byPath: ReadonlyMap<string, MapFile>;
  outgoing: ReadonlyMap<string, readonly string[]>;
  incoming: ReadonlyMap<string, readonly string[]>;
  truncated: boolean;
  dropped: DroppedCounts;
  /** Empty unless the payload was level-of-detail. */
  summaries: readonly GroupSummary[];
  groupImports: readonly GroupImport[];
  /** The repo's size, which is `files.length` unless summaries stand in. */
  totalFileCount: number;
}

const FLAG_KEYS = ["role", "package", "changed", "dead", "inCycle"] as const;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// A later duplicate may only fill in what the first left unknown.
function fillUnknown(first: MapFile, extra: MapFile): MapFile {
  const merged: MapFile = { ...first };
  for (const key of FLAG_KEYS) {
    if (merged[key] === undefined && extra[key] !== undefined) {
      Object.assign(merged, { [key]: extra[key] });
    }
  }
  return merged;
}

function clean(file: MapFile, path: string): MapFile {
  const next: MapFile = { path };
  for (const key of FLAG_KEYS) {
    if (file[key] !== undefined) Object.assign(next, { [key]: file[key] });
  }
  return next;
}

function byPathAscending(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function normaliseGraph(graph: MapGraph): NormalisedGraph {
  const dropped: DroppedCounts = {
    invalidFiles: 0,
    duplicateFiles: 0,
    duplicateImports: 0,
    selfImports: 0,
    unresolvedImports: 0,
  };

  const byPath = new Map<string, MapFile>();
  for (const file of graph.files ?? []) {
    const path = text(file?.path);
    if (!path) {
      dropped.invalidFiles += 1;
      continue;
    }
    const existing = byPath.get(path);
    if (existing) {
      dropped.duplicateFiles += 1;
      byPath.set(path, fillUnknown(existing, file));
      continue;
    }
    byPath.set(path, clean(file, path));
  }

  const seen = new Set<string>();
  const imports: MapImport[] = [];
  for (const edge of graph.imports ?? []) {
    const from = text(edge?.from);
    const to = text(edge?.to);
    if (from && from === to) {
      dropped.selfImports += 1;
      continue;
    }
    if (!byPath.has(from) || !byPath.has(to)) {
      dropped.unresolvedImports += 1;
      continue;
    }
    const key = `${from}\u0000${to}`;
    if (seen.has(key)) {
      dropped.duplicateImports += 1;
      continue;
    }
    seen.add(key);
    imports.push({ from, to });
  }

  imports.sort((a, b) => byPathAscending(a.from, b.from) || byPathAscending(a.to, b.to));

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const path of byPath.keys()) {
    outgoing.set(path, []);
    incoming.set(path, []);
  }
  for (const edge of imports) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }

  const files = [...byPath.values()].sort((a, b) => byPathAscending(a.path, b.path));

  // A summary whose files all arrived has nothing left to stand in for.
  const held = graph.summaries?.length ? filesPerGroup(files) : undefined;
  const summaries = (graph.summaries ?? []).filter(
    (summary) => summary.fileCount > (held?.get(summary.id) ?? 0),
  );
  const summarised = summaries.reduce((sum, summary) => sum + summary.fileCount, 0);

  return {
    files,
    imports,
    byPath,
    outgoing,
    incoming,
    truncated: graph.truncated === true,
    dropped,
    summaries,
    groupImports: graph.groupImports ?? [],
    totalFileCount: graph.totalFileCount ?? files.length + summarised,
  };
}

function filesPerGroup(files: readonly MapFile[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const id = groupIdFor(file);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
