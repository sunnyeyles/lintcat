import type { GroupSlice, MapQuery, MapSearchAnswer } from "@/lib/codebase-map";

/** Where a map gets the parts it was not given. The only thing the modes differ by. */
export interface MapAdapter {
  expandGroup(groupId: string, loadedGroups: readonly string[]): Promise<GroupSlice>;
  search(query: string, limit?: number): Promise<MapSearchAnswer>;
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
      return (await post(endpoint, {
        action: "search",
        query,
        ...(limit === undefined ? {} : { limit }),
      })) as MapSearchAnswer;
    },
  };
}

/** The route's answers without the round trip — what the dev page runs against. */
export function localMapAdapter(query: MapQuery): MapAdapter {
  return {
    async expandGroup(groupId, loadedGroups) {
      const slice = query.expand(groupId, loadedGroups);
      if (!slice) throw new Error("map request failed: 404");
      return slice;
    },
    async search(text, limit) {
      return query.search(text, limit);
    },
  };
}
