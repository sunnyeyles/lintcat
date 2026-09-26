"use client";

import { Button } from "@pr-review/design";
import { useMemo } from "react";

import { httpMapAdapter, type MapAdapter } from "@/components/codebase-map/adapter";
import { MapStatusBanner } from "@/components/codebase-map/map-status-banner";
import { MapWorkspace, PendingGroups } from "@/components/codebase-map/map-workspace";
import { useMapExplorer } from "@/components/codebase-map/use-map-explorer";
import type { FindingHeat, MapGraph } from "@/lib/codebase-map";

import { useFindingsFocus } from "./findings-focus";

export interface ReviewMapProps {
  graph: MapGraph;
  heat: FindingHeat;
  changedPaths: readonly string[];
  /** Where the map fetches the groups it was not sent. Absent below the threshold. */
  endpoint?: string;
}

export function ReviewMap({ graph: input, heat, changedPaths, endpoint }: ReviewMapProps) {
  const { showFile } = useFindingsFocus();

  const adapter: MapAdapter | undefined = useMemo(
    () => (endpoint ? httpMapAdapter(endpoint) : undefined),
    [endpoint],
  );
  const map = useMapExplorer({
    input,
    heat,
    adapter,
    preferredStart: changedPaths[0],
    opening: input,
    changedPaths,
  });

  return (
    <div className="space-y-4">
      <MapStatusBanner status={map.status} />

      <MapWorkspace
        map={map}
        size="review"
        label="Codebase map. Arrow keys move along dependencies, dependents and siblings. Enter toggles a group. Escape clears the focus."
        searcher={adapter?.search}
        onShowFindings={showFile}
        controls={
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => map.handleRef.current?.fit()}>
              Show the whole repo
            </Button>
            <Button size="sm" variant="secondary" onClick={map.fitOpening}>
              Back to the change
            </Button>
            <PendingGroups count={map.pending.size} />
          </div>
        }
      />
    </div>
  );
}
