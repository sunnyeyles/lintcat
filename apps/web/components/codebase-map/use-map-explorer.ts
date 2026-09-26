"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MapAdapter } from "@/components/codebase-map/adapter";
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

export interface MapHover {
  node: SceneNode;
  x: number;
  y: number;
}

const NO_PATHS: readonly string[] = [];
const SHUT = { focusedPath: null, query: "", expandedGroups: new Set<string>() };

interface MapExplorerOptions {
  input: MapGraph;
  heat: FindingHeat;
  adapter?: MapAdapter;
  preferredStart?: string;
  /** The payload the camera opens on; null fits the whole map. */
  opening: MapGraph | null;
  changedPaths?: readonly string[];
}

export function useMapExplorer({
  input,
  heat: inputHeat,
  adapter,
  preferredStart,
  opening: openingGraph,
  changedPaths = NO_PATHS,
}: MapExplorerOptions) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const palette = usePalette(host);
  const reducedMotion = usePrefersReducedMotion();
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [showImpacted, setShowImpacted] = useState(true);
  const [hover, setHover] = useState<MapHover | null>(null);
  const handleRef = useRef<MapHandle | null>(null);

  const { graph, heat, loadedGroups, lod, pending, ensureGroup } = useMapGraph(
    input,
    inputHeat,
    adapter,
  );

  const view = useMemo(
    () => ({ focusedPath, query, expandedGroups, hideImpacted: !showImpacted }),
    [focusedPath, query, expandedGroups, showImpacted],
  );
  const scene = useMemo(() => buildScene(graph, view, 1, heat), [graph, view, heat]);
  const status = useMemo(() => mapStatus(graph), [graph]);

  // Built from the payload handed over, not the live graph, so expanding never moves the camera.
  const opening = useMemo(() => {
    if (!openingGraph) return null;
    const first = normaliseGraph(openingGraph);
    return initialBounds(buildScene(first, SHUT), first, changedPaths);
  }, [openingGraph, changedPaths]);

  const fitOpening = useCallback(() => {
    if (opening) handleRef.current?.fitBounds?.(opening);
    else handleRef.current?.fit();
  }, [opening]);

  // Re-runs once the palette arrives, since the canvas mounts only then.
  useEffect(() => {
    const id = setTimeout(fitOpening, 0);
    return () => clearTimeout(id);
  }, [fitOpening, palette]);

  // Clustering counts ignore the overlay, so hiding it keeps the switch on screen.
  const hasImpacted = useMemo(
    () => scene.clustering.groups.some((group) => group.impactedCount > 0),
    [scene],
  );

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
      // A focused file keeps its group open, so collapsing it has to let the focus go.
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

  const onNodeHover = useCallback(
    (node: SceneNode | null, x: number, y: number) => setHover(node ? { node, x, y } : null),
    [],
  );

  const startingPath = useMemo(() => {
    if (preferredStart !== undefined) return preferredStart;
    const changed = graph.files.find((file) => file.changed === true);
    return (changed ?? graph.files[0])?.path ?? null;
  }, [preferredStart, graph]);

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

  const focusedGroupCollapsed = useMemo(() => {
    if (focusedGroupId === null) return true;
    return scene.clustering.groups.find((group) => group.id === focusedGroupId)?.collapsed ?? true;
  }, [focusedGroupId, scene]);

  const announcement = useMemo(() => {
    if (focusedPath === null) return "No file focused.";
    const hood = neighbourhood(graph, focusedPath, 1);
    const found = heat[focusedPath]?.total ?? 0;
    return `${focusedPath}. ${hood.dependencies.size} dependencies, ${hood.dependents.size} dependents, ${found} findings.`;
  }, [focusedPath, graph, heat]);

  return {
    setHost,
    palette,
    reducedMotion,
    status,
    opening,
    fitOpening,
    graph,
    heat,
    loadedGroups,
    lod,
    pending,
    scene,
    handleRef,
    hover,
    focusedPath,
    setFocusedPath,
    query,
    setQuery,
    setExpandedGroups,
    showImpacted,
    setShowImpacted,
    hasImpacted,
    toggleGroup,
    focusFile,
    onNodeSelect,
    onNodeHover,
    onMapKeyDown,
    focusedGroupId,
    focusedGroupCollapsed,
    announcement,
  };
}
