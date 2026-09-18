import type {
  AreaDescription,
  FileRole,
  FileReferences,
  LanguageCoverage,
  LayerACoverage,
  PackageRecord,
  ReferencesResult,
  SymbolDescription,
  SymbolKind,
  SymbolRecord,
} from "@pr-review/index";
import {
  MAX_REFERENCE_FILES,
  MAX_REFERENCES,
  MAX_SYMBOL_CANDIDATES,
} from "@pr-review/index";

export function batchRows<T>(rows: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("batch size must be at least 1");
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    batches.push(rows.slice(i, i + size));
  }
  return batches;
}

/** "a/b/c.ts" -> "a/b/", a file at the repository root -> "". */
export function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut + 1);
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** The innermost package containing the path; a root package has root "". */
export function packageForPath<T extends { root: string }>(
  packages: readonly T[],
  path: string,
): T | null {
  let best: T | null = null;
  let bestLength = -1;
  for (const pkg of packages) {
    const prefix = pkg.root === "" ? "" : `${pkg.root.replace(/\/+$/, "")}/`;
    if (!path.startsWith(prefix)) continue;
    if (prefix.length > bestLength) {
      best = pkg;
      bestLength = prefix.length;
    }
  }
  return best;
}

export interface TestEdgeRow {
  src: number;
  dst: number;
  testPath: string;
  sourcePath: string;
}

export interface AreaRows {
  path: string;
  fileId: number | null;
  role: FileRole | null;
  language: string | null;
  owners: readonly string[];
  package: PackageRecord | null;
  testEdges: readonly TestEdgeRow[];
  siblings: readonly string[];
  siblingsTotal: number;
}

// An edge into the file means a test covers it; an edge out means the file is the test.
export function toAreaDescription(rows: AreaRows): AreaDescription {
  const sorted = (paths: string[]) => [...new Set(paths)].sort();
  return {
    path: rows.path,
    known: rows.fileId !== null,
    package: rows.package,
    role: rows.role,
    language: rows.language,
    owners: rows.owners,
    tests: sorted(
      rows.testEdges.filter((e) => e.dst === rows.fileId).map((e) => e.testPath),
    ),
    covers: sorted(
      rows.testEdges
        .filter((e) => e.src === rows.fileId)
        .map((e) => e.sourcePath),
    ),
    siblings: rows.siblings,
    siblingsTotal: rows.siblingsTotal,
  };
}

// ---- Layer B: coverage, symbols, references ----

export interface IndexCoverage {
  layerA: LayerACoverage;
  languages: readonly LanguageCoverage[];
}

/** Builds written before Layer B stored a bare LayerACoverage. */
export type StoredCoverage = IndexCoverage | LayerACoverage;

export function readStoredCoverage(stored: StoredCoverage): IndexCoverage {
  return "layerA" in stored
    ? { layerA: stored.layerA, languages: stored.languages ?? [] }
    : { layerA: stored, languages: [] };
}

const SYMBOL_KINDS = new Set<string>([
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "variable",
  "property",
  "module",
  "unknown",
]);

export interface SymbolRow {
  id: number;
  path: string;
  name: string;
  kind: string;
  line: number;
  endLine: number;
  exported: boolean;
}

// `kind` is free text in the table: an indexer we do not know reads as "unknown".
export function toSymbolRecord(row: SymbolRow): SymbolRecord {
  return {
    id: row.id,
    file: row.path,
    name: row.name,
    kind: SYMBOL_KINDS.has(row.kind) ? (row.kind as SymbolKind) : "unknown",
    line: row.line,
    endLine: row.endLine,
    exported: row.exported,
  };
}

export interface SymbolRows {
  path: string;
  name: string;
  symbol: SymbolRow | null;
  candidates: readonly SymbolRow[];
  inboundReferences: number;
  referencingFiles: number;
}

// An unknown path still gets candidates: the same name elsewhere is the useful answer.
export function toSymbolDescription(rows: SymbolRows): SymbolDescription {
  return {
    path: rows.path,
    name: rows.name,
    known: rows.symbol !== null,
    symbol: rows.symbol === null ? null : toSymbolRecord(rows.symbol),
    candidates: rows.candidates
      .filter((c) => c.path !== rows.path)
      .slice(0, MAX_SYMBOL_CANDIDATES)
      .map(toSymbolRecord),
    inboundReferences: rows.symbol === null ? 0 : rows.inboundReferences,
    referencingFiles: rows.symbol === null ? 0 : rows.referencingFiles,
  };
}

export interface ImporterRows {
  path: string;
  known: boolean;
  importers: readonly string[];
  totalImporters: number;
}

export function toImportersResult(rows: ImporterRows): ReferencesResult {
  return {
    path: rows.path,
    name: null,
    known: rows.known,
    importers: [...new Set(rows.importers)].slice(0, MAX_REFERENCE_FILES),
    totalImporters: rows.totalImporters,
    references: [],
    totalReferences: 0,
    totalFiles: 0,
  };
}

export interface ReferenceRow {
  path: string;
  line: number | null;
}

export interface ReferenceRows {
  path: string;
  name: string;
  known: boolean;
  /** Ordered by path, then line. */
  references: readonly ReferenceRow[];
  totalReferences: number;
  totalFiles: number;
}

// Path order is what lets a file be closed once passed; a line repeated is one entry.
export function toReferencesResult(rows: ReferenceRows): ReferencesResult {
  const byFile = new Map<string, number[]>();
  let kept = 0;
  for (const row of rows.references) {
    if (kept >= MAX_REFERENCES) break;
    let lines = byFile.get(row.path);
    if (lines === undefined) {
      if (byFile.size >= MAX_REFERENCE_FILES) continue;
      lines = [];
      byFile.set(row.path, lines);
    }
    if (row.line === null || lines.includes(row.line)) continue;
    lines.push(row.line);
    kept += 1;
  }
  const references: FileReferences[] = [...byFile].map(([file, lines]) => ({
    file,
    lines,
  }));
  return {
    path: rows.path,
    name: rows.name,
    known: rows.known,
    importers: [],
    totalImporters: 0,
    references,
    totalReferences: rows.totalReferences,
    totalFiles: rows.totalFiles,
  };
}
