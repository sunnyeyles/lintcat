"use client";

import dynamic from "next/dynamic";

import { MapSurfaceSkeleton } from "./review-map-skeleton";

const surfaceSkeleton = <MapSurfaceSkeleton />;

// Fetched when first rendered, which the review tabs defer until the Map tab opens.
export const LazyReviewMap = dynamic(() => import("./review-map").then((m) => m.ReviewMap), {
  ssr: false,
  loading: () => surfaceSkeleton,
});
