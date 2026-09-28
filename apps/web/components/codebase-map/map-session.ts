import type { MapAdapter } from "@/components/codebase-map/adapter";
import { initialBounds, type MapBounds } from "@/components/codebase-map/view";
import {
  buildScene,
  clampReach,
  CLOSED_VIEW,
  DEFAULT_REACH,
  expandGroup,
  groupIdFor,
  isTest,
  layoutGroups,
  mapStatus,
  navigate,
  normaliseGraph,
} from "@/lib/codebase-map";
import type {
  FindingHeat,
  MapFile,
  MapGraph,
  MapStatus,
  NavigationAxis,
  NavigationStep,
  NormalisedGraph,
  Scene,
  SceneNode,
} from "@/lib/codebase-map";

export interface MapSessionSource {
  graph: MapGraph;
  heat: FindingHeat;
  changedPaths: readonly string[];
  /** Fetches the groups the payload left out; absent when it sent them all. */
  adapter?: MapAdapter | undefined;
}

export interface MapSessionView {
  focusedPath: string | null;
  query: string;
  expandedGroups: ReadonlySet<string>;
  showImpacted: boolean;
  /** Import steps the change's reach covers, 1 to 3. */
  reachDepth: number;
  showTests: boolean;
}

export interface MapSnapshot {
  graph: NormalisedGraph;
  heat: FindingHeat;
  view: MapSessionView;
  scene: Scene;
  status: MapStatus;
  /** Where the camera opens, from the payload as it arrived; null with no source. */
  opening: MapBounds | null;
  /** Groups whose files are here; the rest are summaries the adapter can fetch. */
  loadedGroups: ReadonlySet<string>;
  lod: boolean;
  pending: ReadonlySet<string>;
  error: string | null;
  hasImpacted: boolean;
  hasTests: boolean;
  /** Files the change reaches within `view.reachDepth`, summaries included. */
  reachedCount: number;
  focusedGroupId: string | null;
  focusedGroupCollapsed: boolean;
  announcement: string;
}

const NO_GRAPH: MapGraph = { files: [], imports: [] };

const OPEN_VIEW: MapSessionView = {
  ...CLOSED_VIEW,
  showImpacted: true,
  reachDepth: DEFAULT_REACH,
  showTests: true,
};


function loadedGroupsOf(graph: NormalisedGraph): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const file of graph.files) ids.add(groupIdFor(file));
  for (const summary of graph.summaries) ids.delete(summary.id);
  return ids;
}

/**
 * One map's state: the view, the graph as slices arrive, and the camera's
 * opening. Switching source discards whatever was still in flight.
 */
export class MapSession {
  #listeners = new Set<() => void>();
  #source: MapSessionSource | null = null;
  #generation = 0;
  #inFlight = new Map<string, Promise<boolean>>();

  #raw: MapGraph = NO_GRAPH;
  #graph: NormalisedGraph = normaliseGraph(NO_GRAPH);
  #loaded: ReadonlySet<string> = new Set();
  #status: MapStatus = mapStatus(this.#graph);
  #heat: FindingHeat = {};
  #opening: MapBounds | null = null;
  #view: MapSessionView = OPEN_VIEW;
  #hasTests = false;
  #pending: ReadonlySet<string> = new Set();
  #error: string | null = null;

  #snapshot: MapSnapshot | null = null;
  #scene: { graph: NormalisedGraph; view: MapSessionView; heat: FindingHeat; scene: Scene } | null =
    null;
  #hiddenStatus: { graph: NormalisedGraph; hidden: number; status: MapStatus } | null = null;

  constructor(source: MapSessionSource | null = null) {
    this.#reset(source);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): MapSnapshot => (this.#snapshot ??= this.#derive());

  load = (source: MapSessionSource | null): void => {
    if (source === this.#source) return;
    this.#reset(source);
    this.#changed();
  };

  focus = (path: string | null): void => this.#setView({ focusedPath: path });

  setQuery = (query: string): void => this.#setView({ query });

  setShowImpacted = (showImpacted: boolean): void => this.#setView({ showImpacted });

  setReachDepth = (depth: number): void => this.#setView({ reachDepth: clampReach(depth) });

  setShowTests = (showTests: boolean): void => this.#setView({ showTests });

  expandLoaded = (): void => this.#setView({ expandedGroups: new Set(this.#loaded) });

  collapseAll = (): void => this.#setView({ expandedGroups: new Set() });

  select = (node: Pick<SceneNode, "id" | "kind">): void => {
    if (node.kind === "group") void this.toggleGroup(node.id);
    else this.focus(node.id);
  };

  toggleGroup = async (groupId: string): Promise<void> => {
    if (!this.#loaded.has(groupId)) {
      if (await this.#ensure(groupId)) this.#setView({ expandedGroups: this.#withExpanded(groupId) });
      return;
    }
    const expandedGroups = new Set(this.#view.expandedGroups);
    const closing = expandedGroups.delete(groupId);
    if (!closing) expandedGroups.add(groupId);
    // A focused file holds its group open, so closing the group lets the focus go.
    const focusedPath =
      closing && this.#groupOf(this.#view.focusedPath) === groupId ? null : this.#view.focusedPath;
    this.#setView({ expandedGroups, focusedPath });
  };

  toggleFocusedGroup = (): void => {
    const groupId = this.#groupOf(this.#view.focusedPath);
    if (groupId !== null) void this.toggleGroup(groupId);
  };

  focusFile = async (path: string, groupId?: string): Promise<void> => {
    if (groupId === undefined || this.#loaded.has(groupId)) {
      this.focus(path);
      return;
    }
    if (!(await this.#ensure(groupId))) return;
    this.#setView({ expandedGroups: this.#withExpanded(groupId), focusedPath: path });
  };

  /** With nothing focused, any step lands on the change. */
  step = (axis: NavigationAxis, direction: NavigationStep): void => {
    const from = this.#view.focusedPath;
    if (from === null) {
      const start = this.#startingPath();
      if (start !== null) this.focus(start);
      return;
    }
    const next = navigate(this.#graph, from, axis, direction);
    if (next) this.focus(next);
  };

  #reset(source: MapSessionSource | null): void {
    this.#source = source;
    this.#generation += 1;
    this.#inFlight = new Map();
    this.#setGraph(pinLayout(source?.graph ?? NO_GRAPH));
    this.#heat = source?.heat ?? {};
    const { showImpacted, reachDepth, showTests } = this.#view;
    this.#view = { ...CLOSED_VIEW, showImpacted, reachDepth, showTests };
    this.#pending = new Set();
    this.#error = null;
    this.#opening = source
      ? initialBounds(buildScene(this.#graph, CLOSED_VIEW), this.#graph, source.changedPaths)
      : null;
  }

  #setGraph(raw: MapGraph): void {
    this.#raw = raw;
    this.#graph = normaliseGraph(raw);
    this.#loaded = loadedGroupsOf(this.#graph);
    this.#status = mapStatus(this.#graph);
    this.#hasTests = this.#graph.files.some(isTest);
  }

  #ensure(groupId: string): Promise<boolean> {
    if (this.#loaded.has(groupId)) return Promise.resolve(true);
    const adapter = this.#source?.adapter;
    if (!adapter) return Promise.resolve(false);
    const running = this.#inFlight.get(groupId);
    if (running) return running;

    const generation = this.#generation;
    const current = () => generation === this.#generation;
    const settle = (ok: boolean, error: string | null) => {
      this.#inFlight.delete(groupId);
      const pending = new Set(this.#pending);
      pending.delete(groupId);
      this.#pending = pending;
      this.#error = error;
      this.#changed();
      return ok;
    };

    this.#pending = new Set(this.#pending).add(groupId);
    this.#changed();
    const request = adapter.expandGroup(groupId, [...this.#loaded]).then(
      (slice) => {
        if (!current()) return false;
        this.#setGraph(expandGroup(this.#raw, groupId, slice.graph));
        this.#heat = { ...this.#heat, ...slice.heat };
        return settle(true, null);
      },
      (cause: unknown) => {
        if (!current()) return false;
        return settle(false, cause instanceof Error ? cause.message : "could not load that group");
      },
    );
    this.#inFlight.set(groupId, request);
    return request;
  }

  #withExpanded(groupId: string): ReadonlySet<string> {
    return new Set(this.#view.expandedGroups).add(groupId);
  }

  #groupOf(path: string | null): string | null {
    const file = path === null ? undefined : this.#graph.byPath.get(path);
    return file ? groupIdFor(file) : null;
  }

  #startingPath(): string | null {
    const preferred = this.#source?.changedPaths[0];
    if (preferred !== undefined) return preferred;
    const changed = this.#graph.files.find((file) => file.changed === true);
    return (changed ?? this.#graph.files[0])?.path ?? null;
  }

  #setView(patch: Partial<MapSessionView>): void {
    this.#view = { ...this.#view, ...patch };
    this.#changed();
  }

  #changed(): void {
    this.#snapshot = null;
    for (const listener of this.#listeners) listener();
  }

  #sceneFor(graph: NormalisedGraph, view: MapSessionView, heat: FindingHeat): Scene {
    const cached = this.#scene;
    if (cached && cached.graph === graph && cached.view === view && cached.heat === heat) {
      return cached.scene;
    }
    const scene = buildScene(
      graph,
      { ...view, hideImpacted: !view.showImpacted, hideTests: !view.showTests },
      1,
      heat,
    );
    this.#scene = { graph, view, heat, scene };
    return scene;
  }

  #statusWith(graph: NormalisedGraph, hidden: number): MapStatus {
    if (hidden === 0) return this.#status;
    const cached = this.#hiddenStatus;
    if (cached && cached.graph === graph && cached.hidden === hidden) return cached.status;
    const status = mapStatus(graph, hidden);
    this.#hiddenStatus = { graph, hidden, status };
    return status;
  }

  #derive(): MapSnapshot {
    const graph = this.#graph;
    const view = this.#view;
    const heat = this.#heat;
    const scene = this.#sceneFor(graph, view, heat);
    const focusedGroupId = this.#groupOf(view.focusedPath);
    const focusedGroup =
      focusedGroupId === null
        ? undefined
        : scene.clustering.groups.find((group) => group.id === focusedGroupId);

    let announcement = `No file focused. The change reaches ${scene.reach.count} files within ${view.reachDepth} import steps.`;
    if (view.focusedPath !== null) {
      const hood = scene.neighbourhood;
      const found = heat[view.focusedPath]?.total ?? 0;
      const about = describeFile(graph.byPath.get(view.focusedPath), scene.reach.files.get(view.focusedPath));
      announcement = `${view.focusedPath}. ${about}${hood.dependencies.size} dependencies, ${hood.dependents.size} dependents, ${found} findings.`;
    }

    return {
      graph,
      heat,
      view,
      scene,
      status: this.#statusWith(graph, scene.hiddenTests),
      opening: this.#opening,
      loadedGroups: this.#loaded,
      lod: graph.summaries.length > 0,
      pending: this.#pending,
      error: this.#error,
      // Clustering counts ignore the overlay, so hiding it keeps the switch on screen.
      hasImpacted: scene.clustering.groups.some((group) => group.impactedCount > 0),
      hasTests: this.#hasTests,
      reachedCount: scene.reach.count,
      focusedGroupId,
      focusedGroupCollapsed: focusedGroup?.collapsed ?? true,
      announcement,
    };
  }
}

/** The payload's own layout, pinned so no later expansion moves a group. */
function pinLayout(raw: MapGraph): MapGraph {
  if (raw.groupPositions || raw.summaries?.some((s) => s.at) || raw.files.length === 0) return raw;
  return { ...raw, groupPositions: layoutGroups(normaliseGraph(raw)) };
}

function describeFile(file: MapFile | undefined, reached: number | undefined): string {
  if (!file) return "";
  const parts = [
    file.change ? `${file.change}${file.previousPath ? ` from ${file.previousPath}` : ""}` : null,
    reached !== undefined ? `reached in ${reached} step${reached === 1 ? "" : "s"}` : null,
    file.dead === true ? "dead" : null,
    file.inCycle === true ? "in an import cycle" : null,
    isTest(file) ? "test" : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `${parts.join(", ")}. ` : "";
}
