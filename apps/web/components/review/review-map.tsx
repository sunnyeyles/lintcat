"use client";

import { Button } from "@pr-review/design";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { httpMapAdapter, type MapAdapter } from "@/components/codebase-map/adapter";
import { FileDetails } from "@/components/codebase-map/file-details";
import { GroupList } from "@/components/codebase-map/group-list";
import { MapCanvas } from "@/components/codebase-map/map-canvas";
import { MapLegend } from "@/components/codebase-map/map-legend";
import { MapSearch } from "@/components/codebase-map/map-search";
import { MapStatusBanner } from "@/components/codebase-map/map-status-banner";
import { usePalette, usePrefersReducedMotion } from "@/components/codebase-map/palette";
import { buildScene, type SceneNode } from "@/components/codebase-map/scene";
import { useMapGraph } from "@/components/codebase-map/use-map-graph";
import { initialBounds, type MapHandle } from "@/components/codebase-map/view";
import {
  groupIdFor,
  mapStatus,
  navigate,
  neighbourhood,
  normaliseGraph,
} from "@/lib/codebase-map";
import type { FindingHeat, MapGraph, NavigationAxis } from "@/lib/codebase-map";

import { useFindingsFocus } from "./findings-focus";

const SURFACE = "h-[60vh] min-h-[380px] w-full";

interface Hover {
  node: SceneNode;
  x: number;
  y: number;
}

export interface ReviewMapProps {
  graph: MapGraph;
  heat: FindingHeat;
  changedPaths: readonly string[];
  /** Where the map fetches the groups it was not sent. Absent below the threshold. */
  endpoint?: string;
}

export function ReviewMap({ graph: input, heat: inputHeat, changedPaths, endpoint }: ReviewMapProps) {
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<Hover | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  const handleRef = useRef<MapHandle | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const palette = usePalette(host);
  const reducedMotion = usePrefersReducedMotion();
  const { showFile } = useFindingsFocus();

  const adapter: MapAdapter | undefined = useMemo(
    () => (endpoint ? httpMapAdapter(endpoint) : undefined),
    [endpoint],
  );
  const { graph, heat, loadedGroups, lod, pending, ensureGroup } = useMapGraph(
    input,
    inputHeat,
    adapter,
  );

  const status = useMemo(() => mapStatus(graph), [graph]);
  const view = useMemo(
    () => ({ focusedPath, query, expandedGroups }),
    [focusedPath, query, expandedGroups],
  );
  const scene = useMemo(() => buildScene(graph, view, 1, heat), [graph, view, heat]);

  // Built from the payload the page shipped, so expanding never moves the camera.
  const opening = useMemo(() => {
    const shut = { focusedPath: null, query: "", expandedGroups: new Set<string>() };
    const first = normaliseGraph(input);
    return initialBounds(buildScene(first, shut), first, changedPaths);
  }, [input, changedPaths]);

  useEffect(() => {
    const id = setTimeout(() => handleRef.current?.fitBounds?.(opening), 0);
    return () => clearTimeout(id);
  }, [opening, palette]);

  useEffect(() => {
    if (focusedPath === null) return;
    const node = scene.byId.get(focusedPath);
    if (node) handleRef.current?.centreOn(node.x, node.y);
  }, [focusedPath, scene]);

  const toggleGroup = useCallback(
    (groupId: string) => {
      if (!loadedGroups.has(groupId)) {
        void ensureGroup(groupId).then((ok) => {
          if (ok) setExpandedGroups((previous) => new Set(previous).add(groupId));
        });
        return;
      }
      setExpandedGroups((previous) => {
        const next = new Set(previous);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        return next;
      });
      setFocusedPath((previous) => {
        if (previous === null || !expandedGroups.has(groupId)) return previous;
        const file = graph.byPath.get(previous);
        return file && groupIdFor(file) === groupId ? null : previous;
      });
    },
    [ensureGroup, expandedGroups, graph, loadedGroups],
  );

  const focusFile = useCallback(
    (path: string, groupId?: string) => {
      if (groupId === undefined || loadedGroups.has(groupId)) {
        setFocusedPath(path);
        return;
      }
      void ensureGroup(groupId).then((ok) => {
        if (!ok) return;
        setExpandedGroups((previous) => new Set(previous).add(groupId));
        setFocusedPath(path);
      });
    },
    [ensureGroup, loadedGroups],
  );

  const onNodeSelect = useCallback(
    (node: SceneNode) => {
      if (node.kind === "group") toggleGroup(node.id);
      else setFocusedPath(node.id);
    },
    [toggleGroup],
  );

  const startingPath = useMemo(
    () => changedPaths[0] ?? graph.files[0]?.path ?? null,
    [changedPaths, graph],
  );

  const onMapKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
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
        const next = navigate(graph, focusedPath, axis, step);
        if (next) setFocusedPath(next);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const file = focusedPath === null ? undefined : graph.byPath.get(focusedPath);
        if (file) toggleGroup(groupIdFor(file));
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setFocusedPath(null);
      }
    },
    [focusedPath, graph, startingPath, toggleGroup],
  );

  const focusedGroupId = useMemo(() => {
    const file = focusedPath === null ? undefined : graph.byPath.get(focusedPath);
    return file ? groupIdFor(file) : null;
  }, [focusedPath, graph]);

  const focusedGroupCollapsed = useMemo(
    () =>
      focusedGroupId === null
        ? true
        : (scene.clustering.groups.find((g) => g.id === focusedGroupId)?.collapsed ?? true),
    [focusedGroupId, scene],
  );

  const announcement = useMemo(() => {
    if (focusedPath === null) return "No file focused.";
    const hood = neighbourhood(graph, focusedPath, 1);
    const found = heat[focusedPath]?.total ?? 0;
    return `${focusedPath}. ${hood.dependencies.size} dependencies, ${hood.dependents.size} dependents, ${found} findings.`;
  }, [focusedPath, graph, heat]);

  return (
    <div className="space-y-4">
      <MapStatusBanner status={status} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div ref={setHost} className="relative">
          <div
            role="application"
            tabIndex={0}
            data-reduced-motion={reducedMotion}
            aria-label="Codebase map. Arrow keys move along dependencies, dependents and siblings. Enter toggles a group. Escape clears the focus."
            onKeyDown={onMapKeyDown}
            className="focus-visible:ring-ring rounded-lg border border-border bg-surface-1 focus-visible:ring-2 focus-visible:outline-none"
          >
            {palette ? (
              <MapCanvas
                scene={scene}
                palette={palette}
                reducedMotion={reducedMotion}
                handleRef={handleRef}
                onSelect={onNodeSelect}
                onHover={(node, x, y) => setHover(node ? { node, x, y } : null)}
                className={`${SURFACE} block`}
              />
            ) : (
              <div className={SURFACE} />
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => handleRef.current?.fit()}>
              Show the whole repo
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => handleRef.current?.fitBounds?.(opening)}
            >
              Back to the change
            </Button>
            {pending.size > 0 ? (
              <span className="text-muted-foreground text-xs" role="status">
                Loading {pending.size} group{pending.size === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          {hover ? (
            <div
              className="border-border bg-popover text-popover-foreground pointer-events-none fixed z-50 max-w-sm rounded-md border px-2 py-1 font-mono text-xs shadow-md"
              style={{ left: hover.x + 12, top: hover.y + 12 }}
            >
              {hover.node.sublabel}
              {hover.node.kind === "group"
                ? ` · ${hover.node.fileCount} files, ${hover.node.changedCount} changed`
                : ""}
              {hover.node.heat.counts.total > 0
                ? ` · ${hover.node.heat.counts.total} findings`
                : ""}
            </div>
          ) : null}

          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </div>

        <aside className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
          <MapSearch
            files={graph.files}
            query={query}
            onQueryChange={setQuery}
            onSelect={focusFile}
            inputRef={searchRef}
            searcher={lod && adapter ? adapter.search : undefined}
            fileCount={graph.totalFileCount}
          />
          <FileDetails
            graph={graph}
            focusedPath={focusedPath}
            groupId={focusedGroupId}
            groupCollapsed={focusedGroupCollapsed}
            onSelect={setFocusedPath}
            onToggleGroup={() => focusedGroupId && toggleGroup(focusedGroupId)}
            heat={heat}
            onShowFindings={showFile}
          />
          <GroupList clustering={scene.clustering} onToggle={toggleGroup} />
          <MapLegend heat />
        </aside>
      </div>
    </div>
  );
}
