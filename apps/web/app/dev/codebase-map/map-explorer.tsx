"use client";

import { Button, cn, Skeleton } from "@pr-review/design";
import { useEffect, useRef, useState } from "react";

import {
  FIXTURE_LABELS,
  FIXTURE_SIZES,
  fixtureSource,
  type FixtureKind,
  type FixtureSource,
} from "@/components/codebase-map/fixtures";
import { MapStatusBanner } from "@/components/codebase-map/map-status-banner";
import {
  mapSurface,
  MapWorkspace,
  PendingGroups,
} from "@/components/codebase-map/map-workspace";
import { useMapExplorer } from "@/components/codebase-map/use-map-explorer";
import type { FindingHeat, MapGraph } from "@/lib/codebase-map";

const FIXTURES: FixtureKind[] = ["ready", "partial", "no-changes", "empty"];
const SURFACE = mapSurface("tall");

const NO_GRAPH: MapGraph = { files: [], imports: [] };
const NO_HEAT: FindingHeat = {};

export function MapExplorer() {
  const [size, setSize] = useState<number>(5000);
  const [fixture, setFixture] = useState<FixtureKind>("ready");
  const [source, setSource] = useState<FixtureSource | null>(null);

  const searchRef = useRef<HTMLInputElement | null>(null);

  const map = useMapExplorer({
    input: source?.graph ?? NO_GRAPH,
    heat: source?.heat ?? NO_HEAT,
    adapter: source?.adapter,
    opening: source?.graph ?? null,
    changedPaths: source?.changedPaths,
  });
  const { handleRef, loadedGroups, lod, pending, status, setFocusedPath, setQuery, setExpandedGroups } =
    map;

  useEffect(() => {
    setSource(null);
    setFocusedPath(null);
    setQuery("");
    setExpandedGroups(new Set());
    const id = setTimeout(() => setSource(fixtureSource(fixture, size)), 0);
    return () => clearTimeout(id);
  }, [fixture, size, setFocusedPath, setQuery, setExpandedGroups]);

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
        setFocusedPath(null);
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocusedPath, setQuery]);

  const placeholder =
    !ready || !map.palette ? (
      <div className={cn(SURFACE, "space-y-3 rounded-lg border border-border bg-surface-1 p-4")}>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-[calc(100%-2.5rem)] w-full" />
        <span className="sr-only" role="status">
          Building the map
        </span>
      </div>
    ) : status.kind === "empty" ? (
      <div
        className={cn(
          SURFACE,
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-1 p-8 text-center",
        )}
      >
        <p className="text-sm font-medium">This map has no files</p>
        <p className="text-muted-foreground max-w-prose text-xs">
          Nothing was indexed, so there is nothing to draw. This is not a claim that the
          repository is empty.
        </p>
      </div>
    ) : undefined;

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
          disabled={map.opening === null}
          onClick={map.fitOpening}
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
        <PendingGroups count={pending.size} />
      </div>

      {ready ? <MapStatusBanner status={status} /> : null}

      <MapWorkspace
        map={map}
        size="tall"
        label="Codebase map. Arrow keys move along dependencies, dependents and siblings. Enter toggles a group. Slash opens search. Escape clears the focus."
        placeholder={placeholder}
        ready={ready}
        sidebarFallback={
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        }
        searcher={source?.adapter?.search}
        searchRef={searchRef}
      />
    </div>
  );
}
