import type { MapSource } from "@/lib/codebase-map";

import { LazyReviewMap } from "./review-map-lazy";
import { MapNoGraph, MapSection } from "./review-map-skeleton";

const noGraph = (
  <MapSection>
    <MapNoGraph />
  </MapSection>
);

export async function ReviewMapSection({
  slug,
  reviewId,
  source,
}: {
  slug: string;
  reviewId: number;
  source: Promise<MapSource>;
}) {
  // Already decoded for the change diagram; only the endpoint goes to the client.
  if ((await source).graph === undefined) return noGraph;

  return (
    <MapSection>
      <LazyReviewMap endpoint={`/api/codebase-map/${encodeURIComponent(slug)}/${reviewId}`} />
    </MapSection>
  );
}
