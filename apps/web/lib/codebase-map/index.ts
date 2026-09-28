export type { ChangeStatus, MapFile, MapGraph, MapViewState } from "@/lib/codebase-map/types";

export { expandGroup } from "@/lib/codebase-map/merge";

export { resolveLodThreshold } from "@/lib/codebase-map/lod";
export type { GroupSlice, LodSearchResult } from "@/lib/codebase-map/lod";

export { mapQuery, SEARCH_LIMIT } from "@/lib/codebase-map/query";
export type { MapQuery, MapSearchAnswer } from "@/lib/codebase-map/query";

export { normaliseGraph } from "@/lib/codebase-map/normalise";
export type { NormalisedGraph } from "@/lib/codebase-map/normalise";

export { buildScene, clampReach } from "@/lib/codebase-map/scene";
export type { Scene, SceneNode } from "@/lib/codebase-map/scene";

export { DEFAULT_REACH, MAX_REACH, neighbourhoodOf } from "@/lib/codebase-map/neighbourhood";
export type { NeighbourDirection, Neighbourhood } from "@/lib/codebase-map/neighbourhood";

export { findingHeat, mapFromSnapshot } from "@/lib/codebase-map/from-snapshot";
export type { FindingHeat, MapSource } from "@/lib/codebase-map/from-snapshot";

export { heatOf } from "@/lib/codebase-map/heat";

export { CLOSED_VIEW, groupIdFor, isTest } from "@/lib/codebase-map/clustering";

export { layoutGroups } from "@/lib/codebase-map/layout";
export type { Clustering } from "@/lib/codebase-map/clustering";

export { EMPHASIS_MARKERS } from "@/lib/codebase-map/emphasis";

export { searchFiles } from "@/lib/codebase-map/search";
export type { SearchResult } from "@/lib/codebase-map/search";

export { navigate } from "@/lib/codebase-map/navigation";
export type { NavigationAxis, NavigationStep } from "@/lib/codebase-map/navigation";

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
