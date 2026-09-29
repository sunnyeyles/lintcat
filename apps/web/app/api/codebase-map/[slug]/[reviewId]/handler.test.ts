import { describe, expect, it, vi } from "vitest";

import {
  groupIdFor,
  mapQuery,
  NO_GRAPH_CODE,
  sampleRepo,
  SEARCH_LIMIT,
  type GroupSlice,
  type MapPayload,
  type MapSearchAnswer,
  type MapSource,
} from "@/lib/codebase-map";
import { createMapSourceLoader } from "@/lib/data/map-source";

import { handleCodebaseMap } from "./handler";

const graph = sampleRepo(7, 6_000);
const changedPaths = graph.files.filter((f) => f.changed === true).map((f) => f.path);
const source: MapSource = { graph, heat: {}, changedPaths };

const load = async () => source;
const missing = async () => undefined;

const held = mapQuery(source).first().graph.summaries!;

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("handleCodebaseMap rejects", () => {
  it("a body that is not one of the two actions", async () => {
    expect((await handleCodebaseMap({ action: "drop" }, load)).status).toBe(400);
    expect((await handleCodebaseMap(null, load)).status).toBe(400);
    expect((await handleCodebaseMap({ action: "expand" }, load)).status).toBe(400);
  });

  it("a limit above the one the server will serve", async () => {
    const response = await handleCodebaseMap(
      { action: "search", query: "a", limit: SEARCH_LIMIT + 1 },
      load,
    );
    expect(response.status).toBe(400);
  });

  it("a review the reader may not have", async () => {
    const response = await handleCodebaseMap(
      { action: "search", query: "session" },
      missing,
    );
    expect(response.status).toBe(404);
    expect(await json<{ error: string }>(response)).toEqual({ error: "review not found" });
  });

  it("a review with no stored graph", async () => {
    const response = await handleCodebaseMap({ action: "search", query: "a" }, async () => ({
      graph: undefined,
      heat: {},
      changedPaths: [],
    }));
    expect(response.status).toBe(404);
  });

  it("a reader who fails the access check, before any cache is read", async () => {
    const baseGraph = vi.fn(async () => null);
    const reviewInputs = vi.fn(async () => null);
    const loader = createMapSourceLoader({ access: async () => null, baseGraph, reviewInputs });

    const response = await handleCodebaseMap({ action: "expand", groupId: held[0]!.id }, () =>
      loader(1),
    );

    expect(response.status).toBe(404);
    expect(baseGraph).not.toHaveBeenCalled();
    expect(reviewInputs).not.toHaveBeenCalled();
  });

  it("a group the repo does not have", async () => {
    const response = await handleCodebaseMap(
      { action: "expand", groupId: "nope::nowhere" },
      load,
    );
    expect(response.status).toBe(404);
  });
});

describe("handleCodebaseMap's first request", () => {
  it("is the map's opening payload, reduced for a repo past the threshold", async () => {
    const response = await handleCodebaseMap({ action: "first" }, load);
    const body = await json<MapPayload>(response);

    expect(response.status).toBe(200);
    expect(body.mode).toBe("lod");
    expect(body.graph.summaries?.map((summary) => summary.id)).toEqual(held.map((s) => s.id));
  });

  it("is not found for another organization's review", async () => {
    const response = await handleCodebaseMap({ action: "first" }, missing);
    expect(response.status).toBe(404);
    expect(await json<{ error: string }>(response)).toEqual({ error: "review not found" });
  });

  it("names a review with no stored graph, so the map can say so", async () => {
    const response = await handleCodebaseMap({ action: "first" }, async () => ({
      graph: undefined,
      heat: {},
      changedPaths: [],
    }));
    expect(response.status).toBe(404);
    expect(await json<{ code: string }>(response)).toMatchObject({ code: NO_GRAPH_CODE });
  });
});

describe("handleCodebaseMap answers", () => {
  it("an expand with the group's slice", async () => {
    const target = held.find((summary) => summary.fileCount > 3)!;
    const response = await handleCodebaseMap({ action: "expand", groupId: target.id }, load);
    const slice = await json<GroupSlice>(response);

    expect(response.status).toBe(200);
    expect(slice.groupId).toBe(target.id);
    expect(slice.graph.files).toHaveLength(target.fileCount);
  });

  it("an expand of a partial group with all of its files, reach included", async () => {
    const first = mapQuery(source).first().graph;
    const sentGroups = new Set(first.files.map((file) => groupIdFor(file)));
    const partial = held.find((summary) => sentGroups.has(summary.id))!;
    const response = await handleCodebaseMap({ action: "expand", groupId: partial.id }, load);
    const slice = await json<GroupSlice>(response);

    expect(partial).toBeDefined();
    expect(slice.graph.files).toHaveLength(partial.fileCount);
    expect(slice.graph.files.some((file) => file.reach !== undefined)).toBe(true);
  });

  it("a search with its results and the repo's size", async () => {
    const response = await handleCodebaseMap({ action: "search", query: "session" }, load);
    const body = await json<MapSearchAnswer>(response);

    expect(body.results).toHaveLength(SEARCH_LIMIT);
    expect(body.results.every((r) => r.groupId !== "")).toBe(true);
    expect(body.totalFileCount).toBe(6_000);
  });
});
