/** An absent flag means UNKNOWN, never false. */
export interface MapFile {
  path: string;
  role?: string;
  package?: string;
  changed?: boolean;
  dead?: boolean;
  inCycle?: boolean;
}

export interface MapImport {
  from: string;
  to: string;
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

/** A group whose files were not sent: counts stand in for them. */
export interface GroupSummary {
  id: string;
  package: string | null;
  directory: string;
  fileCount: number;
  changedCount: number;
  heat: FindingCounts;
}

export interface MapGraph {
  files: MapFile[];
  imports: MapImport[];
  truncated?: boolean;
  /** Level of detail: groups standing in for files the payload left out. */
  summaries?: GroupSummary[];
  /** Import counts between groups, taken over the whole repo, not just `imports`. */
  groupImports?: GroupImport[];
  /** Files in the repo, when `files` is only part of it. */
  totalFileCount?: number;
}

export interface MapViewState {
  focusedPath: string | null;
  query: string;
  expandedGroups: ReadonlySet<string>;
}
