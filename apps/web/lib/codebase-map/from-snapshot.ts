import type { Severity } from "@pr-review/db/dashboard";
import type { RepositoryGraphSnapshot } from "@pr-review/index";
import type { ReviewRecordChangedFile, ReviewRecordOverlay } from "@pr-review/schemas";

import type { NormalisedGraph } from "@/lib/codebase-map/normalise";
import type {
  ChangeStatus,
  FindingCounts,
  MapFile,
  MapGraph,
  MapImport,
} from "@/lib/codebase-map/types";

export type { FindingCounts };

/** Counts per path, plain so it crosses the server boundary unchanged. */
export type FindingHeat = Record<string, FindingCounts>;

export interface MapSourceFinding {
  file: string;
  severity: Severity;
}

export interface MapSource {
  /** Undefined when no snapshot was stored: the index was off or it failed. */
  graph: MapGraph | undefined;
  heat: FindingHeat;
  /** Changed files the graph actually holds, for the opening view. */
  changedPaths: readonly string[];
  /** `graph` already normalised, when a cache holds it. */
  normalised?: NormalisedGraph;
}

function empty(): FindingCounts {
  return { total: 0, high: 0, medium: 0, low: 0 };
}

function boolish(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function packageAt(
  path: string,
  packages: readonly { name: string; root: string }[],
): string | undefined {
  let best: string | undefined;
  let bestLength = -1;
  for (const workspace of packages) {
    const prefix = workspace.root === "" ? "" : `${workspace.root}/`;
    if (path.startsWith(prefix) && workspace.root.length > bestLength) {
      best = workspace.name;
      bestLength = workspace.root.length;
    }
  }
  return best;
}

export function findingHeat(findings: readonly MapSourceFinding[]): FindingHeat {
  const heat: FindingHeat = {};
  for (const finding of findings) {
    const path = typeof finding?.file === "string" ? finding.file.trim() : "";
    if (!path) continue;
    const counts = (heat[path] ??= empty());
    counts.total += 1;
    if (finding.severity === "high") counts.high += 1;
    else if (finding.severity === "medium") counts.medium += 1;
    else if (finding.severity === "low") counts.low += 1;
  }
  return heat;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * `overlay` undefined leaves the base commit exactly as it was; null says the
 * review should have had one and did not, so the map can say so.
 */
export function mapFromSnapshot(
  snapshot: RepositoryGraphSnapshot | undefined,
  changedFiles: readonly ReviewRecordChangedFile[],
  findings: readonly MapSourceFinding[],
  dependents: readonly string[] = [],
  overlay?: ReviewRecordOverlay | null,
): MapSource {
  const heat = findingHeat(findings);
  if (!snapshot) return { graph: undefined, heat, changedPaths: [] };

  const changedStatus = new Map<string, ChangeStatus>();
  for (const file of changedFiles ?? []) {
    const path = text(file?.path);
    if (path) changedStatus.set(path, file.status);
  }

  const overlayStatus = new Map<string, ChangeStatus>();
  const renamedFrom = new Map<string, string>();
  const renamedTo = new Map<string, string>();
  for (const file of overlay?.files ?? []) {
    const path = text(file?.path);
    if (!path) continue;
    overlayStatus.set(path, file.status);
    const previous = text(file.previousPath);
    if (file.status === "renamed" && previous && previous !== path) {
      renamedTo.set(previous, path);
      renamedFrom.set(path, previous);
    }
  }
  const headPath = (path: string) => renamedTo.get(path) ?? path;

  // An empty list is "nobody recorded it", so no file may be called unchanged.
  const listed = changedStatus.size > 0 || overlayStatus.size > 0;

  const impacted = new Set<string>();
  for (const path of dependents ?? []) {
    const trimmed = text(path);
    if (trimmed) impacted.add(headPath(trimmed));
  }

  const withChange = (next: MapFile, path: string) => {
    const change = overlayStatus.get(path);
    if (change === undefined) return;
    next.changed = true;
    next.change = change;
    const previous = renamedFrom.get(path);
    if (previous !== undefined) next.previousPath = previous;
  };

  const files: MapFile[] = [];
  const known = new Set<string>();
  for (const file of snapshot.files ?? []) {
    const path = headPath(file.path);
    if (known.has(path)) continue;
    known.add(path);
    const next: MapFile = { path };
    if (listed) next.changed = changedStatus.has(path) || overlayStatus.has(path);
    withChange(next, path);
    if (impacted.has(path) && next.changed !== true) next.impacted = true;
    if (file.role !== undefined) next.role = file.role;
    if (file.package !== undefined) next.package = file.package;
    const dead = boolish(file.dead);
    if (dead !== undefined) next.dead = dead;
    const inCycle = boolish(file.inCycle);
    if (inCycle !== undefined) next.inCycle = inCycle;
    files.push(next);
  }

  // The snapshot is the base commit, so a file the PR adds is only in the changed list.
  const incoming = new Map(changedStatus);
  for (const [path, status] of overlayStatus) incoming.set(path, status);
  for (const [path, status] of incoming) {
    if (known.has(path) || status === "removed") continue;
    known.add(path);
    const next: MapFile = { path, changed: true };
    withChange(next, path);
    const workspace = packageAt(path, snapshot.packages ?? []);
    if (workspace !== undefined) next.package = workspace;
    files.push(next);
  }

  const imports: MapImport[] = (snapshot.edges ?? []).map((edge) => ({
    from: headPath(edge.from),
    to: headPath(edge.to),
  }));
  if (overlay) applyEdges(imports, overlay);

  const graph: MapGraph = { files, imports, truncated: snapshot.truncated === true };
  if (overlay !== undefined) {
    graph.overlay = overlay === null ? "absent" : overlay.partial ? "partial" : "complete";
  }
  if (typeof snapshot.unresolvedImports === "number") {
    graph.unresolvedImportCount = snapshot.unresolvedImports + (overlay?.unresolvedImportCount ?? 0);
  }
  const changedPaths = files
    .filter((file) => file.changed === true)
    .map((file) => file.path)
    .sort();

  return { graph, heat, changedPaths };
}

// Overlay edges are written in HEAD paths, which the base edges were already moved onto.
function applyEdges(imports: MapImport[], overlay: ReviewRecordOverlay): void {
  const key = (from: string, to: string) => `${from}\u0000${to}`;
  const removed = new Set((overlay.removed ?? []).map((edge) => key(edge.from, edge.to)));
  const present = new Set<string>();
  for (const edge of imports) {
    const id = key(edge.from, edge.to);
    present.add(id);
    if (removed.has(id)) edge.change = "removed";
  }
  for (const edge of overlay.added ?? []) {
    const id = key(edge.from, edge.to);
    if (present.has(id)) continue;
    present.add(id);
    imports.push({ from: edge.from, to: edge.to, change: "added" });
  }
}
