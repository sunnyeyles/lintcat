"use client";

import { Button } from "@pr-review/design";
import { useMemo, useState } from "react";

import { httpMapAdapter } from "@/components/codebase-map/adapter";
import { FileDetails } from "@/components/codebase-map/file-details";
import { GroupList } from "@/components/codebase-map/group-list";
import { MapCanvas } from "@/components/codebase-map/map-canvas";
import { MapHoverCard } from "@/components/codebase-map/map-hover-card";
import { MapLegend } from "@/components/codebase-map/map-legend";
import { MapSearch } from "@/components/codebase-map/map-search";
import { MapStatusBanner } from "@/components/codebase-map/map-status-banner";
import { usePalette, usePrefersReducedMotion } from "@/components/codebase-map/palette";
import { useMapSession } from "@/components/codebase-map/use-map-session";
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

  const source = useMemo(
    () => ({
      graph: input,
      heat: inputHeat,
      changedPaths,
      adapter: endpoint ? httpMapAdapter(endpoint) : undefined,
    }),
    [input, inputHeat, changedPaths, endpoint],
  );
  const map = useMapSession(source);
  const { state, actions, camera } = map;
  const { graph, scene, focusedGroupId } = state;

  return (
    <div className="space-y-4">
      <MapStatusBanner status={state.status} />

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
                handleRef={camera.ref}
                onSelect={actions.select}
                onHover={map.onNodeHover}
                className={`${SURFACE} block`}
              />
            ) : (
              <div className={SURFACE} />
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={camera.fitAll}>
              Show the whole repo
            </Button>
            <Button size="sm" variant="secondary" onClick={camera.fitOpening}>
              Back to the change
            </Button>
            {state.pending.size > 0 ? (
              <span className="text-muted-foreground text-xs" role="status">
                Loading {state.pending.size} group{state.pending.size === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          <MapHoverCard hover={map.hover} />

          <p className="sr-only" role="status" aria-live="polite">
            {state.announcement}
          </p>
        </div>

        <aside className="max-h-[60vh] space-y-6 overflow-y-auto pr-1">
          <MapSearch
            files={graph.files}
            query={state.view.query}
            onQueryChange={actions.setQuery}
            onSelect={actions.focusFile}
            searcher={state.lod ? source.adapter?.search : undefined}
            fileCount={graph.totalFileCount}
          />
          <FileDetails
            graph={graph}
            focusedPath={state.view.focusedPath}
            neighbourhood={scene.neighbourhood}
            groupId={focusedGroupId}
            groupCollapsed={state.focusedGroupCollapsed}
            onSelect={actions.focus}
            onToggleGroup={actions.toggleFocusedGroup}
            heat={state.heat}
            onShowFindings={showFile}
          />
          <GroupList clustering={scene.clustering} onToggle={actions.toggleGroup} />
          <MapLegend
            impacted={
              state.hasImpacted
                ? { shown: state.view.showImpacted, onShownChange: actions.setShowImpacted }
                : undefined
            }
          />
        </aside>
      </div>
    </div>
  );
}
