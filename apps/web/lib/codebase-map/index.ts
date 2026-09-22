export type { MapFile, MapGraph, MapViewState } from "@/lib/codebase-map/types";

export { expandGroup } from "@/lib/codebase-map/merge";

export {
  groupSlice,
  lodGraph,
  mapPayload,
  pathsInGroups,
  resolveLodThreshold,
  searchGroups,
} from "@/lib/codebase-map/lod";
export type { GroupSlice, LodSearchResult } from "@/lib/codebase-map/lod";

export { normaliseGraph } from "@/lib/codebase-map/normalise";
export type { NormalisedGraph } from "@/lib/codebase-map/normalise";

export { neighbourhood, neighbourhoodOf } from "@/lib/codebase-map/neighbourhood";
export type { NeighbourDirection } from "@/lib/codebase-map/neighbourhood";

export { findingHeat, mapFromSnapshot, SEVERITIES } from "@/lib/codebase-map/from-snapshot";
export type { FindingHeat, MapSource } from "@/lib/codebase-map/from-snapshot";

export { heatOf, heatOfPaths } from "@/lib/codebase-map/heat";
export type { Heat } from "@/lib/codebase-map/heat";

export { clusterGraph, groupIdFor } from "@/lib/codebase-map/clustering";
export type { Clustering } from "@/lib/codebase-map/clustering";

export { emphasise, EMPHASIS_MARKERS, EMPHASIS_RANK } from "@/lib/codebase-map/emphasis";
export type { EmphasisLevel } from "@/lib/codebase-map/emphasis";

export { searchFiles } from "@/lib/codebase-map/search";
export type { SearchResult } from "@/lib/codebase-map/search";

export { navigate } from "@/lib/codebase-map/navigation";
export type { NavigationAxis } from "@/lib/codebase-map/navigation";

export { groupCentre, seedLayout } from "@/lib/codebase-map/layout";

export { mapStatus } from "@/lib/codebase-map/status";
export type { MapStatus } from "@/lib/codebase-map/status";

export { sampleRepo } from "@/lib/codebase-map/sample";
