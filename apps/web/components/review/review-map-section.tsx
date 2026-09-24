import type { Finding } from "@pr-review/db";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "@pr-review/design";
import { MapPinOff } from "lucide-react";

import { mapFromSnapshot, mapPayload, resolveLodThreshold } from "@/lib/codebase-map";
import { getChangedFiles, getRepositoryGraph } from "@/lib/data/server";

import { ReviewMap } from "./review-map";

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="map-heading">
      <h2
        id="map-heading"
        className="text-muted-foreground mb-3 font-mono text-xs tracking-wide uppercase"
      >
        Map
      </h2>
      {children}
    </section>
  );
}

export function ReviewMapSkeleton() {
  return (
    <Section>
      <div className="space-y-3 rounded-lg border border-border bg-surface-1 p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-[52vh] min-h-[340px] w-full" />
        <span className="sr-only" role="status">
          Building the codebase map
        </span>
      </div>
    </Section>
  );
}

export async function ReviewMapSection({
  slug,
  reviewId,
  findings,
  dependents,
}: {
  slug: string;
  reviewId: number;
  findings: readonly Finding[];
  /** The stored blast radius; absent for a review scored before it was kept. */
  dependents?: readonly string[];
}) {
  const [snapshot, changedFiles] = await Promise.all([
    getRepositoryGraph(slug, reviewId),
    getChangedFiles(slug, reviewId),
  ]);
  const source = mapFromSnapshot(snapshot, changedFiles, findings, dependents);
  const payload = mapPayload(source, {
    threshold: resolveLodThreshold(process.env.CODEBASE_MAP_LOD_THRESHOLD),
  });

  return (
    <Section>
      {source.graph === undefined ? (
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
      ) : (
        <ReviewMap
          graph={payload.graph}
          heat={payload.heat}
          changedPaths={payload.changedPaths}
          endpoint={`/api/codebase-map/${encodeURIComponent(slug)}/${reviewId}`}
        />
      )}
    </Section>
  );
}
