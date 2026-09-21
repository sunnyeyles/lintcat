"use client";

import { Button, Skeleton } from "@pr-review/design";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FileDetails } from "@/components/codebase-map/file-details";
import {
  FIXTURE_LABELS,
  FIXTURE_SIZES,
  fixtureGraph,
  type FixtureKind,
} from "@/components/codebase-map/fixtures";
import { GroupList } from "@/components/codebase-map/group-list";
import { MapCanvas } from "@/components/codebase-map/map-canvas";
import { MapLegend } from "@/components/codebase-map/map-legend";
import { MapSearch } from "@/components/codebase-map/map-search";
import { MapStatusBanner } from "@/components/codebase-map/map-status-banner";
import { usePalette, usePrefersReducedMotion } from "@/components/codebase-map/palette";
import { buildScene, type SceneNode } from "@/components/codebase-map/scene";
import type { MapHandle } from "@/components/codebase-map/view";
import {
  groupIdFor,
  mapStatus,
  navigate,
  neighbourhood,
  normaliseGraph,
} from "@/lib/codebase-map";
import type { MapStatus, NavigationAxis, NormalisedGraph } from "@/lib/codebase-map";

const FIXTURES: FixtureKind[] = ["ready", "partial", "no-changes", "empty"];
const SURFACE = "h-[68vh] min-h-[420px] w-full";

interface Source {
  graph: NormalisedGraph;
  status: MapStatus;
}

interface Hover {
  node: SceneNode;
  x: number;
  y: number;
}

export function MapExplorer() {
  const [size, setSize] = useState<number>(5000);
  const [fixture, setFixture] = useState<FixtureKind>("ready");
  const [source, setSource] = useState<Source | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<Hover | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  const handleRef = useRef<MapHandle | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const palette = usePalette(host);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    setSource(null);
    setFocusedPath(null);
    setQuery("");
    setExpandedGroups(new Set());
    const id = setTimeout(() => {
      const graph = normaliseGraph(fixtureGraph(fixture, size));
      setSource({ graph, status: mapStatus(graph) });
    }, 0);
    return () => clearTimeout(id);
  }, [fixture, size]);

  const view = useMemo(
    () => ({ focusedPath, query, expandedGroups }),
    [focusedPath, query, expandedGroups],
  );

  const scene = useMemo(
    () => (source ? buildScene(source.graph, view) : null),
    [source, view],
  );

  useEffect(() => {
    const id = setTimeout(() => handleRef.current?.fit(), 0);
    return () => clearTimeout(id);
  }, [source]);

  useEffect(() => {
    if (!scene || focusedPath === null) return;
    const node = scene.byId.get(focusedPath);
    const handle = handleRef.current;
    if (node && handle) handle.centreOn(node.x, node.y);
  }, [focusedPath, scene]);

  const toggleGroup = useCallback(
    (groupId: string) => {
      setExpandedGroups((previous) => {
        const next = new Set(previous);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      });
      // A focused file keeps its group open, so collapsing it has to let the focus go.
      setFocusedPath((previous) => {
        if (previous === null || !expandedGroups.has(groupId)) return previous;
        const file = source?.graph.byPath.get(previous);
        return file && groupIdFor(file) === groupId ? null : previous;
      });
    },
    [expandedGroups, source],
  );

  const onNodeSelect = useCallback(
    (node: SceneNode) => {
      if (node.kind === "group") toggleGroup(node.id);
      else setFocusedPath(node.id);
    },
    [toggleGroup],
  );

  const startingPath = useMemo(() => {
    if (!source) return null;
    const changed = source.graph.files.find((file) => file.changed === true);
    return (changed ?? source.graph.files[0])?.path ?? null;
  }, [source]);

  const onMapKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!source) return;
      const axis: NavigationAxis | null =
        event.key === "ArrowRight"
          ? "dependencies"
          : event.key === "ArrowLeft"
            ? "dependents"
            : event.key === "ArrowDown" || event.key === "ArrowUp"
              ? "siblings"
              : null;

      if (axis) {
        event.preventDefault();
        if (focusedPath === null) {
          if (startingPath) setFocusedPath(startingPath);
          return;
        }
        const step = event.shiftKey || event.key === "ArrowUp" ? "previous" : "next";
        const next = navigate(source.graph, focusedPath, axis, step);
        if (next) setFocusedPath(next);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const file = focusedPath === null ? undefined : source.graph.byPath.get(focusedPath);
        if (file) toggleGroup(groupIdFor(file));
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setFocusedPath(null);
      }
    },
    [focusedPath, source, startingPath, toggleGroup],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && !typing) {
        setFocusedPath(null);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const focusedGroupId = useMemo(() => {
    const file = focusedPath === null ? undefined : source?.graph.byPath.get(focusedPath);
    return file ? groupIdFor(file) : null;
  }, [focusedPath, source]);

  const focusedGroupCollapsed = useMemo(() => {
    if (!scene || focusedGroupId === null) return true;
    return scene.clustering.groups.find((group) => group.id === focusedGroupId)?.collapsed ?? true;
  }, [focusedGroupId, scene]);

  const announcement = useMemo(() => {
    if (!source || focusedPath === null) return "No file focused.";
    const hood = neighbourhood(source.graph, focusedPath, 1);
    return `${focusedPath}. ${hood.dependencies.size} dependencies, ${hood.dependents.size} dependents.`;
  }, [focusedPath, source]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">Files</span>
        {FIXTURE_SIZES.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={option === size ? "default" : "outline"}
            aria-pressed={option === size}
            onClick={() => setSize(option)}
          >
            {option / 1000}k
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <span className="text-muted-foreground text-xs">Data</span>
        {FIXTURES.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={option === fixture ? "default" : "outline"}
            aria-pressed={option === fixture}
            onClick={() => setFixture(option)}
          >
            {FIXTURE_LABELS[option]}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <Button size="sm" variant="secondary" onClick={() => handleRef.current?.fit()}>
          Fit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setExpandedGroups(new Set((source?.graph.files ?? []).map(groupIdFor)))
          }
        >
          Expand all
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setExpandedGroups(new Set())}>
          Reset groups
        </Button>
      </div>

      {source ? <MapStatusBanner status={source.status} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div ref={setHost} className="relative">
          {!source || !scene || !palette ? (
            <div className={`${SURFACE} space-y-3 rounded-lg border border-border bg-surface-1 p-4`}>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-[calc(100%-2.5rem)] w-full" />
              <span className="sr-only" role="status">
                Building the map
              </span>
            </div>
          ) : source.status.kind === "empty" ? (
            <div
              className={`${SURFACE} flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-1 p-8 text-center`}
            >
              <p className="text-sm font-medium">This map has no files</p>
              <p className="text-muted-foreground max-w-prose text-xs">
                Nothing was indexed, so there is nothing to draw. This is not a claim that the
                repository is empty.
              </p>
            </div>
          ) : (
            <div
              role="application"
              tabIndex={0}
              aria-label="Codebase map. Arrow keys move along dependencies, dependents and siblings. Enter toggles a group. Slash opens search. Escape clears the focus."
              onKeyDown={onMapKeyDown}
              className="focus-visible:ring-ring rounded-lg border border-border bg-surface-1 focus-visible:ring-2 focus-visible:outline-none"
            >
              <MapCanvas
                scene={scene}
                palette={palette}
                reducedMotion={reducedMotion}
                handleRef={handleRef}
                onSelect={onNodeSelect}
                onHover={(node, x, y) => setHover(node ? { node, x, y } : null)}
                className={`${SURFACE} block`}
              />
            </div>
          )}

          {hover ? (
            <div
              className="border-border bg-popover text-popover-foreground pointer-events-none fixed z-50 max-w-sm rounded-md border px-2 py-1 font-mono text-xs shadow-md"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              {hover.node.sublabel}
              {hover.node.kind === "group"
                ? ` · ${hover.node.fileCount} files, ${hover.node.changedCount} changed`
                : ""}
            </div>
          ) : null}

          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </div>

        <aside className="max-h-[68vh] space-y-6 overflow-y-auto pr-1">
          {source ? (
            <>
              <MapSearch
                files={source.graph.files}
                query={query}
                onQueryChange={setQuery}
                onSelect={setFocusedPath}
                inputRef={searchRef}
              />
              <FileDetails
                graph={source.graph}
                focusedPath={focusedPath}
                groupId={focusedGroupId}
                groupCollapsed={focusedGroupCollapsed}
                onSelect={setFocusedPath}
                onToggleGroup={() => focusedGroupId && toggleGroup(focusedGroupId)}
              />
              {scene ? <GroupList clustering={scene.clustering} onToggle={toggleGroup} /> : null}
            </>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          <MapLegend />
        </aside>
      </div>
    </div>
  );
}
