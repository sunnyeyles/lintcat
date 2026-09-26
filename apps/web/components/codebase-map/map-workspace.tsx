"use client";

import { cn } from "@pr-review/design";
import type { ReactNode, RefObject } from "react";

import type { MapAdapter } from "@/components/codebase-map/adapter";
import { FileDetails } from "@/components/codebase-map/file-details";
import { GroupList } from "@/components/codebase-map/group-list";
import { MapCanvas } from "@/components/codebase-map/map-canvas";
import { MapHoverCard } from "@/components/codebase-map/map-hover-card";
import { MapLegend } from "@/components/codebase-map/map-legend";
import { MapSearch } from "@/components/codebase-map/map-search";
import type { useMapExplorer } from "@/components/codebase-map/use-map-explorer";
import { countLabel } from "@/lib/format";

export type MapExplorerState = ReturnType<typeof useMapExplorer>;

// Literal class strings, so Tailwind sees every height it has to generate.
const SIZES = {
  review: { surface: "h-[60vh] min-h-[380px] w-full", aside: "max-h-[60vh]" },
  tall: { surface: "h-[68vh] min-h-[420px] w-full", aside: "max-h-[68vh]" },
} as const;

export type MapWorkspaceSize = keyof typeof SIZES;

export function mapSurface(size: MapWorkspaceSize): string {
  return SIZES[size].surface;
}

export function PendingGroups({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="text-muted-foreground text-xs" role="status">
      Loading {countLabel(count, "group")}
    </span>
  );
}

export interface MapWorkspaceProps {
  map: MapExplorerState;
  size: MapWorkspaceSize;
  /** The canvas's accessible name, which lists the keys it answers to. */
  label: string;
  /** Drawn instead of the canvas, as while it loads or when there is nothing to map. */
  placeholder?: ReactNode;
  /** Under the canvas. */
  controls?: ReactNode;
  /** Skeletons stand in for search, details and groups until the data is ready. */
  ready?: boolean;
  sidebarFallback?: ReactNode;
  searcher?: MapAdapter["search"];
  searchRef?: RefObject<HTMLInputElement | null>;
  onShowFindings?: (path: string) => void;
}

export function MapWorkspace({
  map,
  size,
  label,
  placeholder,
  controls,
  ready = true,
  sidebarFallback,
  searcher,
  searchRef,
  onShowFindings,
}: MapWorkspaceProps) {
  const { surface, aside } = SIZES[size];
  const { graph, scene, palette, focusedGroupId, toggleGroup } = map;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div ref={map.setHost} className="relative">
        {placeholder ?? (
          <div
            role="application"
            tabIndex={0}
            data-reduced-motion={map.reducedMotion}
            aria-label={label}
            onKeyDown={map.onMapKeyDown}
            className="focus-visible:ring-ring rounded-lg border border-border bg-surface-1 focus-visible:ring-2 focus-visible:outline-none"
          >
            {palette ? (
              <MapCanvas
                scene={scene}
                palette={palette}
                reducedMotion={map.reducedMotion}
                handleRef={map.handleRef}
                onSelect={map.onNodeSelect}
                onHover={map.onNodeHover}
                className={cn(surface, "block")}
              />
            ) : (
              <div className={surface} />
            )}
          </div>
        )}

        {controls}

        <MapHoverCard hover={map.hover} />

        <p className="sr-only" role="status" aria-live="polite">
          {map.announcement}
        </p>
      </div>

      <aside className={cn(aside, "space-y-6 overflow-y-auto pr-1")}>
        {ready ? (
          <>
            <MapSearch
              files={graph.files}
              query={map.query}
              onQueryChange={map.setQuery}
              onSelect={map.focusFile}
              inputRef={searchRef}
              searcher={map.lod ? searcher : undefined}
              fileCount={graph.totalFileCount}
            />
            <FileDetails
              graph={graph}
              focusedPath={map.focusedPath}
              groupId={focusedGroupId}
              groupCollapsed={map.focusedGroupCollapsed}
              onSelect={map.setFocusedPath}
              onToggleGroup={() => focusedGroupId && toggleGroup(focusedGroupId)}
              heat={map.heat}
              onShowFindings={onShowFindings}
            />
            <GroupList clustering={scene.clustering} onToggle={toggleGroup} />
          </>
        ) : (
          sidebarFallback
        )}
        <MapLegend
          impacted={
            map.hasImpacted
              ? { shown: map.showImpacted, onShownChange: map.setShowImpacted }
              : undefined
          }
        />
      </aside>
    </div>
  );
}
