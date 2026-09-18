/**
 * A built LayerAIndex served from memory. Every lookup map is computed once,
 * at creation, so describeArea is a few map reads.
 */
import {
  MAX_SIBLINGS,
  type AreaDescription,
  type FileRecord,
  type IndexStatus,
  type LayerAIndex,
  type PackageRecord,
  type RepositoryIndex,
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

/** Serves Layer A to the tools; absent mode is the absence of one of these. */
export function createInMemoryIndex(index: LayerAIndex): RepositoryIndex {
  const byPath = new Map(index.files.map((file) => [file.path, file]));
  const byDirectory = groupByDirectory(index.files);
  const byName = new Map(index.packages.map((record) => [record.name, record]));
  const roots = [...index.packages].sort((a, b) => b.root.length - a.root.length);
  const testsBySource = groupEdges(index.tests.map((edge) => [edge.source, edge.test]));
  const coversByTest = groupEdges(index.tests.map((edge) => [edge.test, edge.source]));

  const packageFor = (path: string): PackageRecord | null =>
    roots.find((record) => record.root === "" || path.startsWith(`${record.root}/`)) ??
    null;

  return {
    status(): Promise<IndexStatus> {
      return Promise.resolve({
        sha: index.sha,
        builtAt: index.builtAt,
        coverage: index.coverage,
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
            : (byName.get(file.package) ?? null),
        role: file?.role ?? null,
        language: file?.language ?? null,
        owners: file?.owners ?? [],
        tests: testsBySource.get(path) ?? [],
        covers: coversByTest.get(path) ?? [],
        siblings: neighbours.slice(0, MAX_SIBLINGS),
        siblingsTotal: neighbours.length,
      });
    },
  };
}
