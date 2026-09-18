/**
 * A built RepositoryIndexData served from memory. Every lookup map is computed
 * once, at creation, so each tool call is a few map reads.
 */
import {
  MAX_REFERENCE_FILES,
  MAX_REFERENCES,
  MAX_SIBLINGS,
  MAX_SYMBOL_CANDIDATES,
  type AreaDescription,
  type FileReferences,
  type FileRecord,
  type IndexStatus,
  type LanguageCoverage,
  type PackageRecord,
  type ReferenceRecord,
  type ReferencesResult,
  type RepositoryIndex,
  type RepositoryIndexData,
  type SymbolDescription,
  type SymbolRecord,
} from "./types.js";

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** Rejected before any lookup: the index only ever holds repository-relative paths. */
function isRepositoryPath(path: string): boolean {
  return (
    path !== "" && !path.startsWith("/") && !path.split("/").some((part) => part === "..")
  );
}

function groupByDirectory(
  files: readonly FileRecord[],
): Map<string, string[]> {
  const byDirectory = new Map<string, string[]>();
  for (const file of files) {
    const directory = directoryOf(file.path);
    const bucket = byDirectory.get(directory);
    if (bucket === undefined) byDirectory.set(directory, [file.path]);
    else bucket.push(file.path);
  }
  for (const bucket of byDirectory.values()) bucket.sort();
  return byDirectory;
}

function groupEdges(
  pairs: readonly (readonly [string, string])[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of pairs) {
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [value]);
    else bucket.push(value);
  }
  return grouped;
}

function groupSymbols(
  symbols: readonly SymbolRecord[],
  key: (symbol: SymbolRecord) => string,
): Map<string, SymbolRecord[]> {
  const grouped = new Map<string, SymbolRecord[]>();
  for (const symbol of symbols) {
    const bucket = grouped.get(key(symbol));
    if (bucket === undefined) grouped.set(key(symbol), [symbol]);
    else bucket.push(symbol);
  }
  return grouped;
}

/** Layer A's file counts fill in every language no indexer covered. */
function mergeCoverage(index: RepositoryIndexData): LanguageCoverage[] {
  const merged = new Map<string, LanguageCoverage>();
  for (const [language, files] of Object.entries(index.coverage.languages)) {
    merged.set(language, { language, files, indexed: false, resolutionRate: 0 });
  }
  for (const coverage of index.layerB?.coverage ?? []) {
    merged.set(coverage.language, {
      ...coverage,
      files: index.coverage.languages[coverage.language] ?? coverage.files,
    });
  }
  return [...merged.values()].sort((a, b) => a.language.localeCompare(b.language));
}

function groupReferences(references: readonly ReferenceRecord[]): FileReferences[] {
  const byFile = new Map<string, number[]>();
  for (const reference of references) {
    const bucket = byFile.get(reference.file);
    if (bucket === undefined) byFile.set(reference.file, [reference.line]);
    else bucket.push(reference.line);
  }
  return [...byFile.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, lines]) => ({ file, lines: [...lines].sort((a, b) => a - b) }));
}

/** Files first, then references; both counts stay exact on the result. */
function capReferences(groups: readonly FileReferences[]): FileReferences[] {
  const capped: FileReferences[] = [];
  let taken = 0;
  for (const group of groups.slice(0, MAX_REFERENCE_FILES)) {
    if (taken >= MAX_REFERENCES) break;
    const lines = group.lines.slice(0, MAX_REFERENCES - taken);
    taken += lines.length;
    capped.push({ file: group.file, lines });
  }
  return capped;
}

/** Serves an index to the tools; absent mode is the absence of one of these. */
export function createInMemoryIndex(index: RepositoryIndexData): RepositoryIndex {
  const byPath = new Map(index.files.map((file) => [file.path, file]));
  const byDirectory = groupByDirectory(index.files);
  const packageByName = new Map(index.packages.map((record) => [record.name, record]));
  const roots = [...index.packages].sort((a, b) => b.root.length - a.root.length);
  const testsBySource = groupEdges(index.tests.map((edge) => [edge.source, edge.test]));
  const coversByTest = groupEdges(index.tests.map((edge) => [edge.test, edge.source]));

  const layerB = index.layerB;
  const symbolsByFile = groupSymbols(layerB?.symbols ?? [], (symbol) => symbol.file);
  const symbolsByName = groupSymbols(layerB?.symbols ?? [], (symbol) => symbol.name);
  const referencesBySymbol = new Map<number, ReferenceRecord[]>();
  for (const reference of layerB?.references ?? []) {
    const bucket = referencesBySymbol.get(reference.symbol);
    if (bucket === undefined) referencesBySymbol.set(reference.symbol, [reference]);
    else bucket.push(reference);
  }
  const importersByTarget = groupEdges(
    (layerB?.imports ?? []).map((edge) => [edge.to, edge.from]),
  );
  for (const importers of importersByTarget.values()) importers.sort();
  const languages = mergeCoverage(index);

  const packageFor = (path: string): PackageRecord | null =>
    roots.find((record) => record.root === "" || path.startsWith(`${record.root}/`)) ??
    null;

  /** The definition at `path`: an exported one first, then the earliest line. */
  const symbolAt = (path: string, name: string): SymbolRecord | undefined => {
    const here = (symbolsByFile.get(path) ?? []).filter((symbol) => symbol.name === name);
    const exported = here.filter((symbol) => symbol.exported);
    return (exported.length > 0 ? exported : here).sort((a, b) => a.line - b.line)[0];
  };

  return {
    status(): Promise<IndexStatus> {
      return Promise.resolve({
        sha: index.sha,
        builtAt: index.builtAt,
        coverage: index.coverage,
        languages,
      });
    },

    describeArea(path: string): Promise<AreaDescription> {
      const empty: AreaDescription = {
        path,
        known: false,
        package: null,
        role: null,
        language: null,
        owners: [],
        tests: [],
        covers: [],
        siblings: [],
        siblingsTotal: 0,
      };
      if (!isRepositoryPath(path)) return Promise.resolve(empty);

      const neighbours = (byDirectory.get(directoryOf(path)) ?? []).filter(
        (sibling) => sibling !== path,
      );
      const file = byPath.get(path);
      return Promise.resolve({
        ...empty,
        known: file !== undefined,
        package:
          file?.package === undefined || file.package === null
            ? packageFor(path)
            : (packageByName.get(file.package) ?? null),
        role: file?.role ?? null,
        language: file?.language ?? null,
        owners: file?.owners ?? [],
        tests: testsBySource.get(path) ?? [],
        covers: coversByTest.get(path) ?? [],
        siblings: neighbours.slice(0, MAX_SIBLINGS),
        siblingsTotal: neighbours.length,
      });
    },

    getSymbol(path: string, name: string): Promise<SymbolDescription> {
      const empty: SymbolDescription = {
        path,
        name,
        known: false,
        symbol: null,
        candidates: [],
        inboundReferences: 0,
        referencingFiles: 0,
      };
      if (!isRepositoryPath(path)) return Promise.resolve(empty);

      const candidates = (symbolsByName.get(name) ?? [])
        .filter((symbol) => symbol.file !== path)
        .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
        .slice(0, MAX_SYMBOL_CANDIDATES);
      const symbol = symbolAt(path, name);
      if (symbol === undefined) return Promise.resolve({ ...empty, candidates });

      const references = referencesBySymbol.get(symbol.id) ?? [];
      return Promise.resolve({
        ...empty,
        known: true,
        symbol,
        candidates,
        inboundReferences: references.length,
        referencingFiles: new Set(references.map((reference) => reference.file)).size,
      });
    },

    findReferences(path: string, name?: string): Promise<ReferencesResult> {
      const empty: ReferencesResult = {
        path,
        name: name ?? null,
        known: false,
        importers: [],
        totalImporters: 0,
        references: [],
        totalReferences: 0,
        totalFiles: 0,
      };
      if (!isRepositoryPath(path)) return Promise.resolve(empty);

      if (name === undefined) {
        if (!byPath.has(path)) return Promise.resolve(empty);
        const importers = importersByTarget.get(path) ?? [];
        return Promise.resolve({
          ...empty,
          known: true,
          importers: importers.slice(0, MAX_REFERENCE_FILES),
          totalImporters: importers.length,
        });
      }

      const symbol = symbolAt(path, name);
      if (symbol === undefined) return Promise.resolve(empty);
      const groups = groupReferences(referencesBySymbol.get(symbol.id) ?? []);
      return Promise.resolve({
        ...empty,
        known: true,
        references: capReferences(groups),
        totalReferences: groups.reduce((total, group) => total + group.lines.length, 0),
        totalFiles: groups.length,
      });
    },
  };
}
