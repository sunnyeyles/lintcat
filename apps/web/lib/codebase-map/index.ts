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

export { buildScene } from "@/lib/codebase-map/scene";
export type { Scene, SceneNode } from "@/lib/codebase-map/scene";

export { neighbourhoodOf } from "@/lib/codebase-map/neighbourhood";
export type { NeighbourDirection, Neighbourhood } from "@/lib/codebase-map/neighbourhood";

export { findingHeat, mapFromSnapshot } from "@/lib/codebase-map/from-snapshot";
export type { FindingHeat, MapSource, MapSourceFinding } from "@/lib/codebase-map/from-snapshot";

export { heatOf } from "@/lib/codebase-map/heat";

export { groupIdFor } from "@/lib/codebase-map/clustering";
export type { Clustering } from "@/lib/codebase-map/clustering";

export { EMPHASIS_MARKERS } from "@/lib/codebase-map/emphasis";

export { searchFiles } from "@/lib/codebase-map/search";
export type { SearchResult } from "@/lib/codebase-map/search";

export { navigate } from "@/lib/codebase-map/navigation";
export type { NavigationAxis } from "@/lib/codebase-map/navigation";

export { mapStatus } from "@/lib/codebase-map/status";
export type { MapStatus } from "@/lib/codebase-map/status";

export { sampleRepo } from "@/lib/codebase-map/sample";

export { changeDiagram } from "@/lib/codebase-map/change-diagram";
export type {
  ChangeDiagram,
  DiagramBox,
  DiagramEdge,
  DiagramNode,
} from "@/lib/codebase-map/change-diagram";
