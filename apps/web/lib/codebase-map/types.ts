export type ChangeStatus = "added" | "modified" | "removed" | "renamed";

/** An absent flag means UNKNOWN, never false. */
export interface MapFile {
  path: string;
  role?: string;
  package?: string;
  changed?: boolean;
  /** Set only from a PR overlay; `changed` stays the boolean everything else reads. */
  change?: ChangeStatus;
  /** A renamed file's path at the base commit. */
  previousPath?: string;
  /** Depends on the change; only ever set true, since the stored list is capped. */
  impacted?: boolean;
  /** Import steps from the change over the whole repo, set by the server in level of detail. */
  reach?: number;
  dead?: boolean;
  inCycle?: boolean;
}

export interface MapImport {
  from: string;
  to: string;
  /** Absent means the edge is unchanged at the base. */
  change?: "added" | "removed";
}

export interface FindingCounts {
  total: number;
  high: number;
  medium: number;
  low: number;
}

export interface GroupImport {
  from: string;
  to: string;
  count: number;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

/** A group whose files were not sent: counts stand in for them. */
export interface GroupSummary {
  /** The group id, which already spells out the package and the directory. */
  id: string;
  fileCount: number;
  changedCount: number;
  impactedCount?: number;
  /** Files the change reaches at one, two and three import steps. */
  reachedByDepth?: number[];
  heat?: FindingCounts;
  /** The group's layout point, kept here so the payload names each group once. */
  at?: [number, number];
}

/** How much of the PR the overlay covers; absent on a source that never had one. */
export type OverlayCoverage = "absent" | "partial" | "complete";

export interface MapGraph {
  files: MapFile[];
  imports: MapImport[];
  truncated?: boolean;
  /** Level of detail: groups standing in for files the payload left out. */
  summaries?: GroupSummary[];
  /** Import counts between groups, taken over the whole repo, not just `imports`. */
  groupImports?: GroupImport[];
  /** Group edges the payload budget left out. */
  groupImportsDropped?: number;
  /** Files in the repo, when `files` is only part of it. */
  totalFileCount?: number;
  overlay?: OverlayCoverage;
  /** Imports the index and overlay could not resolve; absent when nothing counted them. */
  unresolvedImportCount?: number;
  /** One point per group, fixed for the life of a map so expanding moves nothing. */
  groupPositions?: Record<string, LayoutPoint>;
}

export interface MapViewState {
  focusedPath: string | null;
  query: string;
  expandedGroups: ReadonlySet<string>;
  /** Turns the impacted overlay off; absent means it is shown. */
  hideImpacted?: boolean;
  /** Import steps the change's reach covers; absent means the default. */
  reachDepth?: number;
  /** Leaves test files out of the scene; absent means they are shown. */
  hideTests?: boolean;
}
