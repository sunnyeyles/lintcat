"use client";

import { Button } from "@pr-review/design";
import { useEffect, useMemo, useState } from "react";

import { httpMapAdapter, type MapAdapter } from "@/components/codebase-map/adapter";
import { FileDetails } from "@/components/codebase-map/file-details";
import { GroupList } from "@/components/codebase-map/group-list";
import { MapCanvas } from "@/components/codebase-map/map-canvas";
import { MapHoverCard } from "@/components/codebase-map/map-hover-card";
import { MapLegend } from "@/components/codebase-map/map-legend";
import { MapSearch } from "@/components/codebase-map/map-search";
import { MapStatusBanner } from "@/components/codebase-map/map-status-banner";
import { usePalette, usePrefersReducedMotion } from "@/components/codebase-map/palette";
import { buildScene } from "@/components/codebase-map/scene";
import { useMapExplorer } from "@/components/codebase-map/use-map-explorer";
import { initialBounds } from "@/components/codebase-map/view";
import { mapStatus, normaliseGraph } from "@/lib/codebase-map";
import type { FindingHeat, MapGraph } from "@/lib/codebase-map";

import { useFindingsFocus } from "./findings-focus";

const SURFACE = "h-[60vh] min-h-[380px] w-full";

export interface ReviewMapProps {
  graph: MapGraph;
  heat: FindingHeat;
  changedPaths: readonly string[];
  /** Where the map fetches the groups it was not sent. Absent below the threshold. */
  endpoint?: string;
}

export function ReviewMap({ graph: input, heat: inputHeat, changedPaths, endpoint }: ReviewMapProps) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const palette = usePalette(host);
  const reducedMotion = usePrefersReducedMotion();
  const { showFile } = useFindingsFocus();

  const adapter: MapAdapter | undefined = useMemo(
    () => (endpoint ? httpMapAdapter(endpoint) : undefined),
    [endpoint],
  );
  const map = useMapExplorer(input, inputHeat, adapter, changedPaths[0]);
  const { graph, heat, scene, handleRef, focusedGroupId, toggleGroup } = map;

  const status = useMemo(() => mapStatus(graph), [graph]);

  // Built from the payload the page shipped, so expanding never moves the camera.
  const opening = useMemo(() => {
    const shut = { focusedPath: null, query: "", expandedGroups: new Set<string>() };
    const first = normaliseGraph(input);
    return initialBounds(buildScene(first, shut), first, changedPaths);
  }, [input, changedPaths]);

  useEffect(() => {
    const id = setTimeout(() => handleRef.current?.fitBounds?.(opening), 0);
    return () => clearTimeout(id);
  }, [handleRef, opening, palette]);

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
            onKeyDown={map.onMapKeyDown}
            className="focus-visible:ring-ring rounded-lg border border-border bg-surface-1 focus-visible:ring-2 focus-visible:outline-none"
          >
            {palette ? (
              <MapCanvas
                scene={scene}
                palette={palette}
                reducedMotion={reducedMotion}
                handleRef={handleRef}
                onSelect={map.onNodeSelect}
                onHover={map.onNodeHover}
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
            {map.pending.size > 0 ? (
              <span className="text-muted-foreground text-xs" role="status">
                Loading {map.pending.size} group{map.pending.size === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          <MapHoverCard hover={map.hover} />

          <p className="sr-only" role="status" aria-live="polite">
            {map.announcement}
          </p>
        </div>

        <aside className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
          <MapSearch
            files={graph.files}
            query={map.query}
            onQueryChange={map.setQuery}
            onSelect={map.focusFile}
                        searcher={map.lod && adapter ? adapter.search : undefined}
            fileCount={graph.totalFileCount}
          />
          <FileDetails
            graph={graph}
            focusedPath={map.focusedPath}
            groupId={focusedGroupId}
            groupCollapsed={map.focusedGroupCollapsed}
            onSelect={map.setFocusedPath}
            onToggleGroup={() => focusedGroupId && toggleGroup(focusedGroupId)}
            heat={heat}
            onShowFindings={showFile}
          />
          <GroupList clustering={scene.clustering} onToggle={toggleGroup} />
          <MapLegend
            impacted={
              map.hasImpacted
                ? { shown: map.showImpacted, onShownChange: map.setShowImpacted }
                : undefined
            }
          />
        </aside>
      </div>
    </div>
  );
}
