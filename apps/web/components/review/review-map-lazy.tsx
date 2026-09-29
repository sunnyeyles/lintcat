"use client";

import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pr-review/design";
import { MapPinOff } from "@pr-review/design/icons";
import { Component, Suspense, use, type ReactNode } from "react";

import { fetchMapPayload } from "@/components/codebase-map/adapter";
import type { MapPayload } from "@/lib/codebase-map";

import { MapNoGraph, MapSurfaceSkeleton } from "./review-map-skeleton";

type Loaded = {
  payload: MapPayload | null;
  ReviewMap: typeof import("./review-map").ReviewMap;
};

const surfaceSkeleton = <MapSurfaceSkeleton />;
const noGraph = <MapNoGraph />;

// One entry: a remount or Strict Mode's second render reuses it, and a graph never piles up.
let last: { endpoint: string; loaded: Promise<Loaded> } | undefined;

function load(endpoint: string): Promise<Loaded> {
  if (last?.endpoint === endpoint) return last.loaded;
  const loaded = Promise.all([fetchMapPayload(endpoint), import("./review-map")]).then(
    ([payload, module]) => ({ payload, ReviewMap: module.ReviewMap }),
  );
  const entry = { endpoint, loaded };
  last = entry;
  loaded.catch(() => {
    if (last === entry) last = undefined;
  });
  return loaded;
}

function LoadedMap({ endpoint }: { endpoint: string }) {
  const { payload, ReviewMap } = use(load(endpoint));
  if (!payload) return noGraph;
  return (
    <ReviewMap
      graph={payload.graph}
      heat={payload.heat}
      changedPaths={payload.changedPaths}
      endpoint={payload.mode === "lod" ? endpoint : undefined}
    />
  );
}

function MapFailed({ retry }: { retry: () => void }) {
  return (
    <Empty className="rounded-lg border border-dashed border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MapPinOff />
        </EmptyMedia>
        <EmptyTitle>The map did not load</EmptyTitle>
        <EmptyDescription>The request for this review&apos;s graph failed.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}

class Retryable extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return <MapFailed retry={() => this.setState({ failed: false })} />;
  }
}

// The graph and the map's code load together, the first time the Map tab opens.
export function LazyReviewMap({ endpoint }: { endpoint: string }) {
  return (
    <Retryable>
      <Suspense fallback={surfaceSkeleton}>
        <LoadedMap endpoint={endpoint} />
      </Suspense>
    </Retryable>
  );
}
