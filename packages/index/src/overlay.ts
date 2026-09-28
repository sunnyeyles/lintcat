/** The pull request at HEAD as a diff over the base graph: files it touches, imports it adds and removes. */
import type { RepositoryIndex } from "#src/build";
import { resolveHeadImports } from "#src/head-imports";
import type { ImpactChange } from "#src/impact";

export interface OverlayEdge {
  readonly from: string;
  readonly to: string;
}

export interface OverlayFile {
  readonly path: string;
  readonly status: ImpactChange["status"];
  readonly previousPath?: string;
}

export interface ChangeOverlay {
  readonly headSha: string;
  readonly files: readonly OverlayFile[];
  readonly added: readonly OverlayEdge[];
  readonly removed: readonly OverlayEdge[];
  /** Internal imports written at HEAD that resolve to nothing. */
  readonly unresolvedImportCount: number;
  readonly partial: boolean;
}

export interface ChangeOverlayInput {
  headSha: string;
  changes: readonly ImpactChange[];
  /** HEAD contents by path; a changed file missing here gets no edge diff. */
  contents: ReadonlyMap<string, string>;
  partial?: boolean | undefined;
}

function byEdge(a: OverlayEdge, b: OverlayEdge): number {
  return a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
}

class EdgeSet {
  readonly #keys = new Set<string>();
  readonly edges: OverlayEdge[] = [];

  add(from: string, to: string): void {
    const key = `${from}\u0000${to}`;
    if (from === to || this.#keys.has(key)) return;
    this.#keys.add(key);
    this.edges.push({ from, to });
  }

  sorted(): OverlayEdge[] {
    return [...this.edges].sort(byEdge);
  }
}

/** Pure: the caller reads HEAD, so a test needs no client. */
export function buildChangeOverlay(
  index: RepositoryIndex,
  input: ChangeOverlayInput,
): ChangeOverlay {
  const renamedTo = new Map<string, string>();
  const addedPaths = new Set<string>();
  const present = new Set<string>();
  for (const change of input.changes) {
    if (change.status !== "removed") present.add(change.path);
    if (change.status === "added" || change.status === "renamed") addedPaths.add(change.path);
    if (change.status === "renamed" && change.previousPath !== undefined) {
      renamedTo.set(change.previousPath, change.path);
    }
  }
  const gone = new Set<string>();
  for (const change of input.changes) {
    const base =
      change.status === "removed"
        ? change.path
        : change.status === "renamed"
          ? change.previousPath
          : undefined;
    if (base !== undefined && !present.has(base)) gone.add(base);
  }
  const headPathOf = (base: string): string => renamedTo.get(base) ?? base;

  const baseOf = (change: ImpactChange): string | undefined =>
    change.status === "added"
      ? undefined
      : change.status === "renamed"
        ? (change.previousPath ?? change.path)
        : change.path;
  const basePaths = new Set(input.changes.flatMap((change) => baseOf(change) ?? []));
  const baseTargets = new Map<string, Set<string>>();
  for (const edge of index.edges) {
    if (edge.to === undefined || !basePaths.has(edge.from)) continue;
    const targets = baseTargets.get(edge.from) ?? new Set<string>();
    targets.add(headPathOf(edge.to));
    baseTargets.set(edge.from, targets);
  }

  const heads = resolveHeadImports(index, {
    contents: input.contents,
    added: addedPaths,
    removed: gone,
  });

  const added = new EdgeSet();
  const removed = new EdgeSet();
  let unresolvedImportCount = 0;
  for (const change of input.changes) {
    const base = baseOf(change);
    const before = base === undefined ? new Set<string>() : (baseTargets.get(base) ?? new Set());
    if (change.status === "removed") {
      for (const to of before) removed.add(change.path, to);
      continue;
    }
    const imports = heads.get(change.path);
    if (imports === undefined) continue;
    const after = new Set<string>();
    for (const entry of imports) {
      if (entry.path !== undefined) after.add(entry.path);
      else if (entry.internal) unresolvedImportCount += 1;
    }
    for (const to of after) if (!before.has(to)) added.add(change.path, to);
    for (const to of before) if (!after.has(to)) removed.add(change.path, to);
  }

  return {
    headSha: input.headSha,
    files: input.changes.map(({ path, status, previousPath }) => ({
      path,
      status,
      ...(status === "renamed" && previousPath !== undefined ? { previousPath } : {}),
    })),
    added: added.sorted(),
    removed: removed.sorted(),
    unresolvedImportCount,
    partial: input.partial === true,
  };
}
