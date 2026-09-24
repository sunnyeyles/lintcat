"use client";

import { Button, Skeleton } from "@pr-review/design";
import { useEffect, useMemo, useRef, useState } from "react";

import { FileDetails } from "@/components/codebase-map/file-details";
import {
  FIXTURE_LABELS,
  FIXTURE_SIZES,
  fixtureSource,
  type FixtureKind,
  type FixtureSource,
} from "@/components/codebase-map/fixtures";
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

const FIXTURES: FixtureKind[] = ["ready", "partial", "no-changes", "empty"];
const SURFACE = "h-[68vh] min-h-[420px] w-full";

const NO_GRAPH: MapGraph = { files: [], imports: [] };
const NO_HEAT: FindingHeat = {};

export function MapExplorer() {
  const [size, setSize] = useState<number>(5000);
  const [fixture, setFixture] = useState<FixtureKind>("ready");
  const [source, setSource] = useState<FixtureSource | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const palette = usePalette(host);
  const reducedMotion = usePrefersReducedMotion();

  const map = useMapExplorer(
    source?.graph ?? NO_GRAPH,
    source?.heat ?? NO_HEAT,
    source?.adapter,
  );
  const {
    graph,
    heat,
    scene,
    handleRef,
    loadedGroups,
    lod,
    pending,
    focusedGroupId,
    toggleGroup,
    setFocusedPath,
    setQuery,
    setExpandedGroups,
  } = map;

  useEffect(() => {
    setSource(null);
    setFocusedPath(null);
    setQuery("");
    setExpandedGroups(new Set());
    const id = setTimeout(() => setSource(fixtureSource(fixture, size)), 0);
    return () => clearTimeout(id);
  }, [fixture, size, setFocusedPath, setQuery, setExpandedGroups]);

  const ready = source !== null;
  const status = useMemo(() => mapStatus(graph), [graph]);

  // Built from the payload the fixture handed over, so expanding never moves the camera.
  const opening = useMemo(() => {
    if (!source) return null;
    const shut = { focusedPath: null, query: "", expandedGroups: new Set<string>() };
    const first = normaliseGraph(source.graph);
    return initialBounds(buildScene(first, shut), first, source.changedPaths);
  }, [source]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (opening) handleRef.current?.fitBounds?.(opening);
      else handleRef.current?.fit();
    }, 0);
    return () => clearTimeout(id);
  }, [handleRef, opening, palette]);

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
  }, [setFocusedPath, setQuery]);

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
          disabled={opening === null}
          onClick={() => opening && handleRef.current?.fitBounds?.(opening)}
        >
          Open on the change
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setExpandedGroups(new Set(loadedGroups))}
        >
          Expand loaded
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setExpandedGroups(new Set())}>
          Reset groups
        </Button>
        {lod ? (
          <span className="text-muted-foreground text-xs" data-testid="lod-mode">
            level of detail
          </span>
        ) : null}
        {pending.size > 0 ? (
          <span className="text-muted-foreground text-xs" role="status">
            Loading {pending.size} group{pending.size === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {ready ? <MapStatusBanner status={status} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div ref={setHost} className="relative">
          {!ready || !palette ? (
            <div className={`${SURFACE} space-y-3 rounded-lg border border-border bg-surface-1 p-4`}>
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-[calc(100%-2.5rem)] w-full" />
              <span className="sr-only" role="status">
                Building the map
              </span>
            </div>
          ) : status.kind === "empty" ? (
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
              data-reduced-motion={reducedMotion}
              aria-label="Codebase map. Arrow keys move along dependencies, dependents and siblings. Enter toggles a group. Slash opens search. Escape clears the focus."
              onKeyDown={map.onMapKeyDown}
              className="focus-visible:ring-ring rounded-lg border border-border bg-surface-1 focus-visible:ring-2 focus-visible:outline-none"
            >
              <MapCanvas
                scene={scene}
                palette={palette}
                reducedMotion={reducedMotion}
                handleRef={handleRef}
                onSelect={map.onNodeSelect}
                onHover={map.onNodeHover}
                className={`${SURFACE} block`}
              />
            </div>
          )}

          <MapHoverCard hover={map.hover} />

          <p className="sr-only" role="status" aria-live="polite">
            {map.announcement}
          </p>
        </div>

        <aside className="max-h-[68vh] space-y-6 overflow-y-auto pr-1">
          {ready ? (
            <>
              <MapSearch
                files={graph.files}
                query={map.query}
                onQueryChange={setQuery}
                onSelect={map.focusFile}
                inputRef={searchRef}
                searcher={lod ? source?.adapter?.search : undefined}
                fileCount={graph.totalFileCount}
              />
              <FileDetails
                graph={graph}
                focusedPath={map.focusedPath}
                groupId={focusedGroupId}
                groupCollapsed={map.focusedGroupCollapsed}
                onSelect={setFocusedPath}
                onToggleGroup={() => focusedGroupId && toggleGroup(focusedGroupId)}
                heat={heat}
              />
              <GroupList clustering={scene.clustering} onToggle={toggleGroup} />
            </>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          <MapLegend heat />
        </aside>
      </div>
    </div>
  );
}
