import type { GroupSlice, MapPayload, MapQuery, MapSearchAnswer } from "@/lib/codebase-map";
import { NO_GRAPH_CODE } from "@/lib/codebase-map/endpoint";

/** Where a map gets the parts it was not given. The only thing the modes differ by. */
export interface MapAdapter {
  expandGroup(groupId: string, loadedGroups: readonly string[]): Promise<GroupSlice>;
  search(query: string, limit?: number): Promise<MapSearchAnswer>;
}

function send(endpoint: string, body: unknown): Promise<Response> {
  return fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function post(endpoint: string, body: unknown): Promise<unknown> {
  const response = await send(endpoint, body);
  if (!response.ok) throw new Error(`map request failed: ${response.status}`);
  return response.json();
}

/** The map's opening payload; null for a review stored without a graph. */
export async function fetchMapPayload(endpoint: string): Promise<MapPayload | null> {
  const response = await send(endpoint, { action: "first" });
  if (response.status === 404) {
    const body = (await response.json().catch(() => null)) as { code?: unknown } | null;
    if (body?.code === NO_GRAPH_CODE) return null;
  }
  if (!response.ok) throw new Error(`map request failed: ${response.status}`);
  return (await response.json()) as MapPayload;
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
