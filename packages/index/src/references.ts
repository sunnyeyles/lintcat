/** Who imports a file, and who imports one name from it. */
import type { ImportEdge } from "#src/build";
import type { ImportKind } from "#src/imports";

/** One import statement, as a reference to the file it points at. */
export interface ReferenceImport {
  readonly line: number;
  /** "side-effect" for an import that binds nothing. */
  readonly kind: ImportKind | "side-effect";
  /** Absent for a side-effect import. */
  readonly name?: string;
}

/** One file that imports the subject, and every statement that does so. */
export interface Reference {
  readonly path: string;
  readonly imports: readonly ReferenceImport[];
}

/** A namespace import reaches every name, so it answers any query. */
function matchingImports(edge: ImportEdge, name: string | undefined): ReferenceImport[] {
  if (edge.names.length === 0) {
    return name === undefined ? [{ line: edge.line, kind: "side-effect" }] : [];
  }
  return edge.names
    .filter(
      (imported) =>
        name === undefined ||
        imported.kind === "namespace" ||
        imported.name === name,
    )
    .map((imported) => ({
      line: edge.line,
      kind: imported.kind,
      name: imported.name,
    }));
}

/** Every file importing `path`, or importing `name` from it, sorted by path. */
export function referencesTo(
  importers: ReadonlyMap<string, readonly ImportEdge[]>,
  path: string,
  name?: string,
): Reference[] {
  const byFile = new Map<string, ReferenceImport[]>();
  for (const edge of importers.get(path) ?? []) {
    const matches = matchingImports(edge, name);
    if (matches.length === 0) {
      continue;
    }
    const existing = byFile.get(edge.from);
    if (existing === undefined) {
      byFile.set(edge.from, matches);
    } else {
      existing.push(...matches);
    }
  }
  return [...byFile]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, imports]) => ({
      path: file,
      imports: imports.sort((a, b) => a.line - b.line),
    }));
}
