export type { MapFile, MapGraph, MapImport, MapViewState } from "@/lib/codebase-map/types";

export { normaliseGraph } from "@/lib/codebase-map/normalise";
export type { DroppedCounts, NormalisedGraph } from "@/lib/codebase-map/normalise";

export { neighbourhood, neighbourhoodOf } from "@/lib/codebase-map/neighbourhood";
export type {
  Neighbour,
  NeighbourDirection,
  Neighbourhood,
} from "@/lib/codebase-map/neighbourhood";

export { findingHeat, mapFromSnapshot, SEVERITIES } from "@/lib/codebase-map/from-snapshot";
export type {
  FindingCounts,
  FindingHeat,
  MapSource,
  MapSourceFinding,
} from "@/lib/codebase-map/from-snapshot";

export { HEAT_BANDS, heatLabel, heatOf, heatOfPaths, NO_HEAT } from "@/lib/codebase-map/heat";
export type { Heat } from "@/lib/codebase-map/heat";

export { clusterGraph, directoryOf, groupIdFor } from "@/lib/codebase-map/clustering";
export type { Clustering, GroupImport, MapGroup } from "@/lib/codebase-map/clustering";

export { emphasise, EMPHASIS_MARKERS, EMPHASIS_RANK } from "@/lib/codebase-map/emphasis";
export type { EmphasisLevel, FileEmphasis } from "@/lib/codebase-map/emphasis";

export { searchFiles, SEARCH_RANK } from "@/lib/codebase-map/search";
export type { SearchMatchKind, SearchResult } from "@/lib/codebase-map/search";

export { navigate, navigationCandidates } from "@/lib/codebase-map/navigation";
export type { NavigationAxis, NavigationStep } from "@/lib/codebase-map/navigation";

export { seedLayout, seedPosition, seedPositionFor } from "@/lib/codebase-map/layout";
export type { LayoutOptions, LayoutPoint } from "@/lib/codebase-map/layout";

export { mapStatus } from "@/lib/codebase-map/status";
export type {
  FlagCoverage,
  MapStatus,
  MapStatusKind,
  StatusReason,
  StatusReasonCode,
} from "@/lib/codebase-map/status";

export { sampleRepo } from "@/lib/codebase-map/sample";
