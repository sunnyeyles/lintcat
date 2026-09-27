import { describe, expect, it } from "vitest";

import {
  mapQuery,
  sampleRepo,
  SEARCH_LIMIT,
  type GroupSlice,
  type MapSearchAnswer,
  type MapSource,
} from "@/lib/codebase-map";

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

  it("a group the repo does not have", async () => {
    const response = await handleCodebaseMap(
      { action: "expand", groupId: "nope::nowhere" },
      load,
    );
    expect(response.status).toBe(404);
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

  it("a search with its results and the repo's size", async () => {
    const response = await handleCodebaseMap({ action: "search", query: "session" }, load);
    const body = await json<MapSearchAnswer>(response);

    expect(body.results).toHaveLength(SEARCH_LIMIT);
    expect(body.results.every((r) => r.groupId !== "")).toBe(true);
    expect(body.totalFileCount).toBe(6_000);
  });
});
