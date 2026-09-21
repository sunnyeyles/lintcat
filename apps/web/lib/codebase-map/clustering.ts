import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import type { MapFile, MapViewState } from "@/lib/codebase-map/types";

export interface MapGroup {
  id: string;
  package: string | null;
  directory: string;
  files: readonly string[];
  changedCount: number;
  containsFocus: boolean;
  internalImports: number;
  collapsed: boolean;
}

export interface GroupImport {
  from: string;
  to: string;
  count: number;
}

export interface Clustering {
  groups: readonly MapGroup[];
  imports: readonly GroupImport[];
  groupOfFile: ReadonlyMap<string, string>;
}

export function directoryOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "." : path.slice(0, cut);
}

export function groupIdFor(file: MapFile): string {
  return `${file.package ?? "-"}::${directoryOf(file.path)}`;
}

interface Draft {
  id: string;
  package: string | null;
  directory: string;
  files: string[];
  changedCount: number;
  containsFocus: boolean;
  internalImports: number;
}

export function clusterGraph(graph: NormalisedGraph, view: MapViewState): Clustering {
  const drafts = new Map<string, Draft>();
  const groupOfFile = new Map<string, string>();

  for (const file of graph.files) {
    const id = groupIdFor(file);
    let draft = drafts.get(id);
    if (!draft) {
      draft = {
        id,
        package: file.package ?? null,
        directory: directoryOf(file.path),
        files: [],
        changedCount: 0,
        containsFocus: false,
        internalImports: 0,
      };
      drafts.set(id, draft);
    }
    draft.files.push(file.path);
    if (file.changed === true) draft.changedCount += 1;
    if (file.path === view.focusedPath) draft.containsFocus = true;
    groupOfFile.set(file.path, id);
  }

  const merged = new Map<string, GroupImport>();
  for (const edge of graph.imports) {
    const from = groupOfFile.get(edge.from);
    const to = groupOfFile.get(edge.to);
    if (from === undefined || to === undefined) continue;
    if (from === to) {
      const draft = drafts.get(from);
      if (draft) draft.internalImports += 1;
      continue;
    }
    const key = `${from}\u0000${to}`;
    const existing = merged.get(key);
    if (existing) existing.count += 1;
    else merged.set(key, { from, to, count: 1 });
  }

  const groups: MapGroup[] = [...drafts.values()]
    .map((draft) => ({
      ...draft,
      collapsed: !(
        draft.changedCount > 0 ||
        draft.containsFocus ||
        view.expandedGroups.has(draft.id)
      ),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const imports = [...merged.values()].sort(
    (a, b) =>
      (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) ||
      (a.to < b.to ? -1 : a.to > b.to ? 1 : 0),
  );

  return { groups, imports, groupOfFile };
}
