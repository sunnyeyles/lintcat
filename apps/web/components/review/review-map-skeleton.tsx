import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "@pr-review/design";
import { MapPinOff } from "@pr-review/design/icons";
import type { ReactNode } from "react";

import { SectionHeading } from "@/components/ui";

export function MapSection({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="map-heading" className="flex flex-col gap-4">
      <SectionHeading id="map-heading" title="Map" />
      {children}
    </section>
  );
}

// Same grid as ReviewMap, so the canvas lands where the skeleton was.
export function MapSurfaceSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Skeleton className="h-[60vh] min-h-[380px] w-full rounded-lg" />
      <div className="hidden space-y-3 lg:block">
        <Skeleton className="h-control w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <span className="sr-only" role="status">
        Building the codebase map
      </span>
    </div>
  );
}

export function ReviewMapSkeleton() {
  return (
    <MapSection>
      <MapSurfaceSkeleton />
    </MapSection>
  );
}

export function MapNoGraph() {
  return (
    <Empty className="rounded-lg border border-dashed border-border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MapPinOff />
        </EmptyMedia>
        <EmptyTitle>No repository graph for this review</EmptyTitle>
        <EmptyDescription>
          Indexing was off or it failed when this review ran, so there is nothing to draw.
          This is not a claim that the repository is empty. A later review on this repo
          will have a map once indexing succeeds.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
