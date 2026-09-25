import { baseName } from "@/lib/codebase-map/clustering";
import type { MapFile } from "@/lib/codebase-map/types";

type SearchMatchKind = "name-prefix" | "segment" | "substring";

export interface SearchResult {
  path: string;
  kind: SearchMatchKind;
  rank: number;
}

const SEARCH_RANK: Record<SearchMatchKind, number> = {
  "name-prefix": 0,
  segment: 1,
  substring: 2,
};

function kindOf(path: string, needle: string): SearchMatchKind | null {
  const lower = path.toLowerCase();
  if (baseName(lower).startsWith(needle)) return "name-prefix";
  if (lower.split("/").some((segment) => segment.startsWith(needle))) return "segment";
  return lower.includes(needle) ? "substring" : null;
}

export function searchFiles(
  files: readonly MapFile[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const results: SearchResult[] = [];
  for (const file of files) {
    const kind = kindOf(file.path, needle);
    if (kind) results.push({ path: file.path, kind, rank: SEARCH_RANK[kind] });
  }

  results.sort(
    (a, b) => a.rank - b.rank || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  return Number.isFinite(limit) ? results.slice(0, Math.max(0, limit)) : results;
}
