"use client";

import { Button, Skeleton } from "@pr-review/design";
import { useEffect, useRef, useState } from "react";

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
import { useMapSession } from "@/components/codebase-map/use-map-session";

const FIXTURES: FixtureKind[] = ["ready", "partial", "no-changes", "empty"];
const SURFACE = "h-[68vh] min-h-[420px] w-full";

export function MapExplorer() {
  const [size, setSize] = useState<number>(5000);
  const [fixture, setFixture] = useState<FixtureKind>("ready");
  const [source, setSource] = useState<FixtureSource | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const palette = usePalette(host);
  const reducedMotion = usePrefersReducedMotion();

  const map = useMapSession(source);
  const { state, actions, camera } = map;
  const { graph, scene, status, focusedGroupId } = state;

  useEffect(() => {
    setSource(null);
    const id = setTimeout(() => setSource(fixtureSource(fixture, size)), 0);
    return () => clearTimeout(id);
  }, [fixture, size]);

  const ready = source !== null;

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
        actions.focus(null);
        actions.setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

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
        <Button size="sm" variant="secondary" onClick={camera.fitAll}>
          Fit
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={state.opening === null}
          onClick={camera.fitOpening}
        >
          Open on the change
        </Button>
        <Button size="sm" variant="secondary" onClick={actions.expandLoaded}>
          Expand loaded
        </Button>
        <Button size="sm" variant="secondary" onClick={actions.collapseAll}>
          Reset groups
        </Button>
        {state.lod ? (
          <span className="text-muted-foreground text-xs" data-testid="lod-mode">
            level of detail
          </span>
        ) : null}
        {state.pending.size > 0 ? (
          <span className="text-muted-foreground text-xs" role="status">
            Loading {state.pending.size} group{state.pending.size === 1 ? "" : "s"}
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
                handleRef={camera.ref}
                onSelect={actions.select}
                onHover={map.onNodeHover}
                className={`${SURFACE} block`}
              />
            </div>
          )}

          <MapHoverCard hover={map.hover} />

          <p className="sr-only" role="status" aria-live="polite">
            {state.announcement}
          </p>
        </div>

        <aside className="max-h-[68vh] space-y-6 overflow-y-auto pr-1">
          {ready ? (
            <>
              <MapSearch
                files={graph.files}
                query={state.view.query}
                onQueryChange={actions.setQuery}
                onSelect={actions.focusFile}
                inputRef={searchRef}
                searcher={state.lod ? source?.adapter?.search : undefined}
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
              />
              <GroupList clustering={scene.clustering} onToggle={actions.toggleGroup} />
            </>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
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
