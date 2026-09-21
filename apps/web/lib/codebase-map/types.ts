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

export interface MapGraph {
  files: MapFile[];
  imports: MapImport[];
  truncated?: boolean;
}

export interface MapViewState {
  focusedPath: string | null;
  query: string;
  expandedGroups: ReadonlySet<string>;
}
