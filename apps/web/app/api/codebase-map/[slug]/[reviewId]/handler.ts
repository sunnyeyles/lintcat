import { z } from "zod";

import {
  groupSlice,
  normaliseGraph,
  pathsInGroups,
  searchGroups,
  type MapSource,
} from "@/lib/codebase-map";

export const SEARCH_LIMIT = 40;

const GROUP_ID = z.string().min(1).max(1024);

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("expand"),
    groupId: GROUP_ID,
    /** Groups the map already holds, so no edge arrives pointing at nothing. */
    loadedGroups: z.array(GROUP_ID).max(20_000).default([]),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string().max(200),
    limit: z.number().int().positive().max(SEARCH_LIMIT).default(SEARCH_LIMIT),
  }),
]);

export type MapRequest = z.infer<typeof requestSchema>;

/** Resolves the review's map source, or undefined when the reader may not have it. */
export type LoadMapSource = () => Promise<MapSource | undefined>;

/** The route body, with the loader passed in so tests need no database. */
export async function handleCodebaseMap(
  body: unknown,
  load: LoadMapSource,
): Promise<Response> {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid map request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const source = await load();
  if (!source) return Response.json({ error: "review not found" }, { status: 404 });
  if (!source.graph) {
    return Response.json({ error: "no repository graph for this review" }, { status: 404 });
  }

  const graph = normaliseGraph(source.graph);

  if (parsed.data.action === "search") {
    const results = searchGroups(graph, parsed.data.query, parsed.data.limit);
    return Response.json({ results, totalFileCount: graph.files.length });
  }

  const { groupId, loadedGroups } = parsed.data;
  const slice = groupSlice(graph, source.heat, groupId, pathsInGroups(graph, loadedGroups));
  if (slice.graph.files.length === 0) {
    return Response.json({ error: `no group ${groupId}` }, { status: 404 });
  }
  return Response.json(slice);
}
