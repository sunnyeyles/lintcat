import {
  groupSlice,
  normaliseGraph,
  pathsInGroups,
  searchGroups,
  type GroupSlice,
  type LodSearchResult,
  type MapSource,
} from "@/lib/codebase-map";

/** Where a map gets the parts it was not given. The only thing the modes differ by. */
export interface MapAdapter {
  expandGroup(groupId: string, loadedGroups: readonly string[]): Promise<GroupSlice>;
  search(query: string, limit?: number): Promise<LodSearchResult[]>;
}

async function post(endpoint: string, body: unknown): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`map request failed: ${response.status}`);
  return response.json();
}

export function httpMapAdapter(endpoint: string): MapAdapter {
  return {
    async expandGroup(groupId, loadedGroups) {
      return (await post(endpoint, {
        action: "expand",
        groupId,
        loadedGroups: [...loadedGroups],
      })) as GroupSlice;
    },
    async search(query, limit) {
      const body = (await post(endpoint, {
        action: "search",
        query,
        ...(limit === undefined ? {} : { limit }),
      })) as { results: LodSearchResult[] };
      return body.results;
    },
  };
}

/** The same answers, computed here — what the dev page runs against. */
export function localMapAdapter(source: MapSource): MapAdapter {
  const graph = normaliseGraph(source.graph ?? { files: [], imports: [] });
  return {
    async expandGroup(groupId, loadedGroups) {
      return groupSlice(graph, source.heat, groupId, pathsInGroups(graph, loadedGroups));
    },
    async search(query, limit = 40) {
      return searchGroups(graph, query, limit);
    },
  };
}
