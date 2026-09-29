import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pr-review/design";
import { MapPinOff } from "@pr-review/design/icons";

import { mapQuery, resolveLodThreshold, type MapSource } from "@/lib/codebase-map";

import { LazyReviewMap } from "./review-map-lazy";
import { MapSection } from "./review-map-skeleton";

const noGraph = (
  <MapSection>
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
  </MapSection>
);

export async function ReviewMapSection({
  slug,
  reviewId,
  source: pending,
}: {
  slug: string;
  reviewId: number;
  source: Promise<MapSource>;
}) {
  const source = await pending;
  if (source.graph === undefined) return noGraph;

  const payload = mapQuery(source).first({
    threshold: resolveLodThreshold(process.env.CODEBASE_MAP_LOD_THRESHOLD),
  });

  return (
    <MapSection>
      <LazyReviewMap
        graph={payload.graph}
        heat={payload.heat}
        changedPaths={payload.changedPaths}
        endpoint={
          payload.mode === "lod"
            ? `/api/codebase-map/${encodeURIComponent(slug)}/${reviewId}`
            : undefined
        }
      />
    </MapSection>
  );
}
