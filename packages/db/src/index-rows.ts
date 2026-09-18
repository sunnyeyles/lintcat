import type { AreaDescription, FileRole, PackageRecord } from "@pr-review/index";

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
