import { describe, expect, it } from "vitest";

import {
  expandGroup,
  findingHeat,
  groupIdFor,
  lodGraph,
  mapPayload,
  normaliseGraph,
  sampleRepo,
  type GroupSlice,
  type LodSearchResult,
  type MapSource,
} from "@/lib/codebase-map";

import { handleCodebaseMap, SEARCH_LIMIT } from "./handler";

const graph = sampleRepo(7, 6_000);
const heat = findingHeat(
  graph.files
    .filter((_, i) => i % 13 === 0)
    .map((file) => ({ file: file.path, severity: "medium" as const })),
);
const changedPaths = graph.files.filter((f) => f.changed === true).map((f) => f.path);
const source: MapSource = { graph, heat, changedPaths };

const load = async () => source;
const missing = async () => undefined;

const normalised = normaliseGraph(graph);
const payload = mapPayload(source);
const held = payload.graph.summaries!;
const openGroupIds = [
  ...new Set(payload.graph.files.map((file) => groupIdFor(file))),
];

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

describe("handleCodebaseMap expand", () => {
  const target = held.find((summary) => summary.fileCount > 3)!;

  it("returns every file of the group", async () => {
    const response = await handleCodebaseMap(
      { action: "expand", groupId: target.id, loadedGroups: openGroupIds },
      load,
    );
    const slice = await json<GroupSlice>(response);

    expect(response.status).toBe(200);
    expect(slice.groupId).toBe(target.id);
    expect(slice.graph.files).toHaveLength(target.fileCount);
    expect(slice.graph.files.every((f) => groupIdFor(f) === target.id)).toBe(true);
  });

  it("merges into the first payload without leaving a dangling edge", async () => {
    const response = await handleCodebaseMap(
      { action: "expand", groupId: target.id, loadedGroups: openGroupIds },
      load,
    );
    const slice = await json<GroupSlice>(response);
    const merged = normaliseGraph(expandGroup(payload.graph, target.id, slice.graph));

    expect(merged.dropped.unresolvedImports).toBe(0);
    expect(merged.summaries.some((s) => s.id === target.id)).toBe(false);
    expect(merged.totalFileCount).toBe(6_000);
  });

  it("sends no edge to a group the caller did not say it holds", async () => {
    const response = await handleCodebaseMap(
      { action: "expand", groupId: target.id },
      load,
    );
    const slice = await json<GroupSlice>(response);
    const mine = new Set(slice.graph.files.map((f) => f.path));

    expect(slice.graph.imports.every((e) => mine.has(e.from) && mine.has(e.to))).toBe(true);
  });

  it("carries the findings on the files it sends", async () => {
    const withHeat = held.find(
      (summary) =>
        normalised.files.some((f) => groupIdFor(f) === summary.id && heat[f.path]),
    )!;
    const response = await handleCodebaseMap(
      { action: "expand", groupId: withHeat.id },
      load,
    );
    const slice = await json<GroupSlice>(response);

    expect(Object.keys(slice.heat).length).toBeGreaterThan(0);
  });
});

describe("handleCodebaseMap search", () => {
  it("finds a file the first payload left out, and names the group to open", async () => {
    const sent = new Set(payload.graph.files.map((f) => f.path));
    const hidden = normalised.files.find((file) => !sent.has(file.path))!;

    const response = await handleCodebaseMap(
      { action: "search", query: hidden.path },
      load,
    );
    const body = await json<{ results: LodSearchResult[]; totalFileCount: number }>(response);
    const hit = body.results.find((r) => r.path === hidden.path)!;

    expect(hit.groupId).toBe(groupIdFor(hidden));
    expect(body.totalFileCount).toBe(6_000);
    expect(held.some((summary) => summary.id === hit.groupId)).toBe(true);
  });

  it("never returns more than the limit", async () => {
    const response = await handleCodebaseMap(
      { action: "search", query: "session", limit: 5 },
      load,
    );
    expect((await json<{ results: unknown[] }>(response)).results).toHaveLength(5);
  });

  it("returns nothing for an empty query", async () => {
    const response = await handleCodebaseMap({ action: "search", query: "  " }, load);
    expect((await json<{ results: unknown[] }>(response)).results).toEqual([]);
  });
});

describe("a repo under the threshold", () => {
  it("still answers, so the client needs no second code path", async () => {
    const small = sampleRepo(3, 60);
    const tiny: MapSource = { graph: small, heat: {}, changedPaths: [] };
    const groupId = groupIdFor(small.files[0]!);

    const response = await handleCodebaseMap({ action: "expand", groupId }, async () => tiny);
    expect(response.status).toBe(200);
  });
});

describe("lodGraph and the handler agree", () => {
  it("expands exactly what the first payload summarised", async () => {
    const lod = lodGraph(normalised, changedPaths, heat, { openFiles: 300 });
    let merged = lod;
    for (const summary of lod.summaries!.slice(0, 5)) {
      const response = await handleCodebaseMap(
        {
          action: "expand",
          groupId: summary.id,
          loadedGroups: [...new Set(merged.files.map((f) => groupIdFor(f)))],
        },
        load,
      );
      const slice = await json<GroupSlice>(response);
      merged = expandGroup(merged, summary.id, slice.graph);
    }

    expect(normaliseGraph(merged).dropped.unresolvedImports).toBe(0);
    expect(merged.summaries!.length).toBe(lod.summaries!.length - 5);
  });
});
