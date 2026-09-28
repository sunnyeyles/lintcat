import { describe, expect, it } from "vitest";

import { groupIdFor } from "./clustering";
import { findingHeat, type MapSource } from "./from-snapshot";
import { DEFAULT_LOD_BUDGET, DEFAULT_LOD_THRESHOLD, lodGraph } from "./lod";
import { expandGroup } from "./merge";
import { normaliseGraph } from "./normalise";
import { mapQuery, SEARCH_LIMIT } from "./query";
import { sampleRepo } from "./sample";
import type { MapGraph } from "./types";

/** The stated budget: the first payload at 50k files must fit in this. */
const BYTE_BUDGET = 900_000;

const PR_SIZE = 150;

// Changed files always ship, so a budget test holds the PR's size fixed as the repo grows.
function sourceOf(fileCount: number, changedCap = Infinity): MapSource {
  const sample = sampleRepo(7, fileCount);
  let kept = 0;
  const graph = {
    ...sample,
    files: sample.files.map((file) =>
      file.changed === true && (kept += 1) > changedCap ? { ...file, changed: false } : file,
    ),
  };
  const heat = findingHeat(
    graph.files
      .filter((_, i) => i % 13 === 0)
      .map((file) => ({ file: file.path, severity: "medium" as const })),
  );
  const changedPaths = graph.files.filter((f) => f.changed === true).map((f) => f.path);
  return { graph, heat, changedPaths };
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

const source = sourceOf(6_000);
const query = mapQuery(source);
const normalised = normaliseGraph(source.graph!);
const payload = query.first();
const held = payload.graph.summaries!;
const openGroupIds = [...new Set(payload.graph.files.map((file) => groupIdFor(file)))];

describe("the first payload below the threshold", () => {
  it("hands back the very same graph, heat and changed paths", () => {
    const small = sourceOf(400);
    const first = mapQuery(small).first({ threshold: DEFAULT_LOD_THRESHOLD });

    expect(first.mode).toBe("full");
    expect(first.graph).toBe(small.graph);
    expect(first.heat).toBe(small.heat);
    expect(first.changedPaths).toBe(small.changedPaths);
  });

  it("stays full at exactly the threshold", () => {
    expect(mapQuery(sourceOf(200)).first({ threshold: 200 }).mode).toBe("full");
    expect(mapQuery(sourceOf(201)).first({ threshold: 200 }).mode).toBe("lod");
  });

  it("is empty and full for a review with no graph", () => {
    const first = mapQuery({ graph: undefined, heat: {}, changedPaths: [] }).first();
    expect(first).toMatchObject({ mode: "full", graph: { files: [], imports: [] } });
  });
});

describe("the 50k payload", () => {
  const big = mapQuery(sourceOf(50_000, PR_SIZE)).first({ threshold: DEFAULT_LOD_THRESHOLD });
  const bytes = bytesOf(big);
  const unchanged = (graph: MapGraph) => graph.files.filter((f) => f.changed !== true).length;

  it("goes level-of-detail, within its byte and file budgets", () => {
    expect(big.mode).toBe("lod");
    expect(bytes).toBeLessThan(BYTE_BUDGET);
    expect(unchanged(big.graph)).toBeLessThanOrEqual(DEFAULT_LOD_BUDGET.openFiles);
  });

  it("ships every changed file, however many there are", () => {
    const huge = sourceOf(50_000);
    const first = mapQuery(huge).first({ threshold: DEFAULT_LOD_THRESHOLD });

    expect(first.changedPaths).toEqual(huge.changedPaths);
    expect(unchanged(first.graph)).toBeLessThanOrEqual(DEFAULT_LOD_BUDGET.openFiles);
  });

  it("holds its size when the repo doubles", () => {
    const bigger = mapQuery(sourceOf(100_000, PR_SIZE)).first({ threshold: DEFAULT_LOD_THRESHOLD });

    expect(unchanged(bigger.graph)).toBeLessThanOrEqual(DEFAULT_LOD_BUDGET.openFiles);
    expect(bigger.graph.groupImports!.length).toBe(big.graph.groupImports!.length);
    // Twice the repo, and only the summaries' own digits grow.
    expect(bytesOf(bigger) / bytes).toBeLessThan(1.1);
  }, 30_000);
});

describe("expand", () => {
  const target = held.find((summary) => summary.fileCount > 3)!;

  it("returns every file of the group and nothing else", () => {
    const slice = query.expand(target.id, openGroupIds)!;

    expect(slice.groupId).toBe(target.id);
    expect(slice.graph.files).toHaveLength(target.fileCount);
    expect(slice.graph.files.every((f) => groupIdFor(f) === target.id)).toBe(true);
  });

  it("merges into the first payload without leaving a dangling edge", () => {
    const slice = query.expand(target.id, openGroupIds)!;
    const merged = normaliseGraph(expandGroup(payload.graph, target.id, slice.graph));

    expect(merged.dropped.missingEndpoints).toBe(0);
    expect(merged.summaries.some((s) => s.id === target.id)).toBe(false);
    expect(merged.totalFileCount).toBe(6_000);
  });

  it("sends no edge to a group the caller did not say it holds", () => {
    const slice = query.expand(target.id, [])!;
    const mine = new Set(slice.graph.files.map((f) => f.path));

    expect(slice.graph.imports.every((e) => mine.has(e.from) && mine.has(e.to))).toBe(true);
  });

  it("carries the findings of the files it sends", () => {
    const withHeat = held.find((summary) =>
      normalised.files.some((f) => groupIdFor(f) === summary.id && source.heat[f.path]),
    )!;
    const slice = query.expand(withHeat.id, [])!;

    expect(Object.keys(slice.heat).length).toBeGreaterThan(0);
    for (const [path, counts] of Object.entries(slice.heat)) {
      expect(counts).toEqual(source.heat[path]);
    }
  });

  it("carries the impacted flag on the files it sends", () => {
    const hit = new Set(
      normalised.files
        .filter((f) => groupIdFor(f) === target.id && f.changed !== true)
        .slice(0, 2)
        .map((f) => f.path),
    );
    const graph = source.graph!;
    const impacted = mapQuery({
      ...source,
      graph: {
        ...graph,
        files: graph.files.map((f) => (hit.has(f.path) ? { ...f, impacted: true } : f)),
      },
    });
    const slice = impacted.expand(target.id, openGroupIds)!;
    const flagged = slice.graph.files.filter((f) => f.impacted === true).map((f) => f.path);

    expect(hit.size).toBe(2);
    expect(flagged.sort()).toEqual([...hit].sort());
  });

  it("finds nothing for a group the repo does not have", () => {
    expect(query.expand("nope::nowhere", [])).toBeUndefined();
  });

  it("still answers under the threshold", () => {
    const small = sourceOf(60);
    const groupId = groupIdFor(small.graph!.files[0]!);
    expect(mapQuery(small).expand(groupId, [])).toBeDefined();
  });

  it("expands exactly what lodGraph summarised", () => {
    const lod = lodGraph(normalised, source.changedPaths, source.heat, { openFiles: 300 });
    let merged = lod;
    for (const summary of lod.summaries!.slice(0, 5)) {
      const loaded = [...new Set(merged.files.map((f) => groupIdFor(f)))];
      merged = expandGroup(merged, summary.id, query.expand(summary.id, loaded)!.graph);
    }

    expect(normaliseGraph(merged).dropped.missingEndpoints).toBe(0);
    expect(merged.summaries!.length).toBe(lod.summaries!.length - 5);
  });
});

describe("search", () => {
  it("finds a file the first payload left out, and names the group to open", () => {
    const sent = new Set(payload.graph.files.map((f) => f.path));
    const hidden = normalised.files.find((file) => !sent.has(file.path))!;

    const answer = query.search(hidden.path);
    const hit = answer.results.find((r) => r.path === hidden.path)!;

    expect(hit.groupId).toBe(groupIdFor(hidden));
    expect(answer.totalFileCount).toBe(6_000);
    expect(held.some((summary) => summary.id === hit.groupId)).toBe(true);
  });

  it("honours the limit, never past the one it serves, and the shared ranking", () => {
    const { results } = query.search("session", 5);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.rank)).toEqual([...results.map((r) => r.rank)].sort());
    expect(query.search("session", SEARCH_LIMIT * 2).results).toHaveLength(SEARCH_LIMIT);
  });

  it("returns nothing for an empty query", () => {
    expect(query.search("  ").results).toEqual([]);
  });
});
