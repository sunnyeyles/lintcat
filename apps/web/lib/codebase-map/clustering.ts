import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import type {
  FindingCounts,
  GroupImport,
  MapFile,
  MapViewState,
} from "@/lib/codebase-map/types";

export type { GroupImport };

export interface MapGroup {
  id: string;
  package: string | null;
  directory: string;
  files: readonly string[];
  /** The group's real size, which exceeds `files.length` while it is a summary. */
  fileCount: number;
  changedCount: number;
  containsFocus: boolean;
  internalImports: number;
  collapsed: boolean;
  /** False while the group is a summary: its files have not been fetched. */
  loaded: boolean;
  /** A summary's finding counts, since its files are not here to sum. */
  heatCounts?: FindingCounts;
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

const NO_PACKAGE = "-";

export function groupIdFor(file: MapFile): string {
  return `${file.package ?? NO_PACKAGE}::${directoryOf(file.path)}`;
}

/** Reads back what `groupIdFor` wrote, so a summary need not repeat it. */
export function groupIdParts(id: string): { package: string | null; directory: string } {
  const cut = id.indexOf("::");
  if (cut === -1) return { package: null, directory: id };
  const name = id.slice(0, cut);
  return { package: name === NO_PACKAGE ? null : name, directory: id.slice(cut + 2) };
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

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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
  for (const edge of graph.groupImports) {
    merged.set(`${edge.from}\u0000${edge.to}`, edge);
  }

  const summaries = new Map(graph.summaries.map((summary) => [summary.id, summary]));

  const loaded: MapGroup[] = [...drafts.values()].map((draft) => {
    const summary = summaries.get(draft.id);
    const fileCount = Math.max(draft.files.length, summary?.fileCount ?? 0);
    return {
      ...draft,
      fileCount,
      changedCount: Math.max(draft.changedCount, summary?.changedCount ?? 0),
      loaded: draft.files.length >= fileCount,
      ...(summary?.heat ? { heatCounts: summary.heat } : {}),
      collapsed: false,
    };
  });

  const standIns: MapGroup[] = graph.summaries
    .filter((summary) => !drafts.has(summary.id))
    .map((summary) => ({
      id: summary.id,
      ...groupIdParts(summary.id),
      files: [],
      fileCount: summary.fileCount,
      changedCount: summary.changedCount,
      containsFocus: false,
      internalImports: 0,
      loaded: false,
      ...(summary.heat ? { heatCounts: summary.heat } : {}),
      collapsed: true,
    }));

  const groups = [...loaded, ...standIns]
    .map((group) => ({
      ...group,
      // A group whose files are still on the server can only be drawn collapsed.
      collapsed:
        !group.loaded ||
        !(
          group.changedCount > 0 ||
          group.containsFocus ||
          view.expandedGroups.has(group.id)
        ),
    }))
    .sort(byId);

  const imports = [...merged.values()].sort(
    (a, b) =>
      (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) ||
      (a.to < b.to ? -1 : a.to > b.to ? 1 : 0),
  );

  return { groups, imports, groupOfFile };
}
