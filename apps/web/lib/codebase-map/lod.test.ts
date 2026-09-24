import { describe, expect, it } from "vitest";

import { clusterGraph, groupIdParts } from "./clustering";
import { findingHeat, type FindingHeat, type MapSourceFinding } from "./from-snapshot";
import {
  DEFAULT_LOD_BUDGET,
  DEFAULT_LOD_THRESHOLD,
  groupSlice,
  lodGraph,
  mapPayload,
  resolveLodThreshold,
  searchGroups,
} from "./lod";
import { normaliseGraph } from "./normalise";
import { sampleRepo } from "./sample";
import type { MapGraph, MapViewState } from "./types";

const SEED = 7;
const SHUT: MapViewState = { focusedPath: null, query: "", expandedGroups: new Set() };

/** The stated budget: the first payload at 50k files must fit in this. */
const BYTE_BUDGET = 900_000;

function heatFor(graph: MapGraph): FindingHeat {
  const findings: MapSourceFinding[] = graph.files
    .filter((_, i) => i % 11 === 0)
    .map((file, i) => ({ file: file.path, severity: i % 3 === 0 ? "high" : "low" }));
  return findingHeat(findings);
}

function sourceOf(fileCount: number) {
  const graph = sampleRepo(SEED, fileCount);
  const changedPaths = graph.files.filter((f) => f.changed === true).map((f) => f.path);
  return { graph, heat: heatFor(graph), changedPaths };
}

function bytesOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

describe("resolveLodThreshold", () => {
  it("falls back to the default, then env, then the caller's override", () => {
    expect(resolveLodThreshold(undefined)).toBe(DEFAULT_LOD_THRESHOLD);
    expect(resolveLodThreshold("")).toBe(DEFAULT_LOD_THRESHOLD);
    expect(resolveLodThreshold("not a number")).toBe(DEFAULT_LOD_THRESHOLD);
    expect(resolveLodThreshold("120")).toBe(120);
    expect(resolveLodThreshold("120", 7)).toBe(7);
  });
});

describe("mapPayload below the threshold", () => {
  it("hands back the very same graph, heat and changed paths", () => {
    const source = sourceOf(400);
    const payload = mapPayload(source, { threshold: DEFAULT_LOD_THRESHOLD });

    expect(payload.mode).toBe("full");
    expect(payload.graph).toBe(source.graph);
    expect(payload.heat).toBe(source.heat);
    expect(payload.changedPaths).toBe(source.changedPaths);
  });

  it("stays full at exactly the threshold", () => {
    expect(mapPayload(sourceOf(200), { threshold: 200 }).mode).toBe("full");
    expect(mapPayload(sourceOf(201), { threshold: 200 }).mode).toBe("lod");
  });
});

describe("lodGraph", () => {
  const source = sourceOf(3000);
  const graph = normaliseGraph(source.graph);
  const lod = lodGraph(graph, source.changedPaths, source.heat, { openFiles: 400 });

  it("summarises every group whose files it left behind", () => {
    const all = clusterGraph(graph, SHUT);
    const sent = new Set(lod.files.map((file) => file.path));
    const summarised = new Set(lod.summaries!.map((s) => s.id));

    for (const group of all.groups) {
      const anySent = group.files.some((path) => sent.has(path));
      expect(anySent || summarised.has(group.id)).toBe(true);
    }
    expect(summarised.size + new Set(lod.files.map((f) => f.path)).size).toBeGreaterThan(0);
  });

  it("gives each summary the group's real counts and finding sum", () => {
    const all = clusterGraph(graph, SHUT);
    const summary = lod.summaries!.find(
      (s) => s.fileCount > 1 && (s.heat?.total ?? 0) > 0,
    )!;
    const group = all.groups.find((g) => g.id === summary.id)!;

    expect(summary.fileCount).toBe(group.files.length);
    expect(groupIdParts(summary.id).directory).toBe(group.directory);
    const total = group.files.reduce((sum, p) => sum + (source.heat[p]?.total ?? 0), 0);
    expect(summary.heat!.total).toBe(total);
  });

  it("sends whole groups, so no edge points at a file it left out", () => {
    const sent = new Set(lod.files.map((file) => file.path));
    for (const edge of lod.imports) {
      expect(sent.has(edge.from) && sent.has(edge.to)).toBe(true);
    }
    expect(normaliseGraph(lod).dropped.unresolvedImports).toBe(0);
  });

  it("opens the groups the change lands in first", () => {
    const sent = new Set(lod.files.map((file) => file.path));
    const changedSent = source.changedPaths.filter((path) => sent.has(path));
    expect(changedSent.length).toBeGreaterThan(0);
  });

  it("keeps the repo's real size, not the size it sent", () => {
    expect(lod.totalFileCount).toBe(3000);
    expect(lod.files.length).toBeLessThan(3000);
  });
});

describe("the 50k payload", () => {
  const source = sourceOf(50_000);
  const payload = mapPayload(source, { threshold: DEFAULT_LOD_THRESHOLD });
  const bytes = bytesOf(payload);

  it("goes level-of-detail", () => {
    expect(payload.mode).toBe("lod");
    expect(source.changedPaths.length / 50_000).toBeGreaterThan(0.04);
  });

  it(`fits in ${BYTE_BUDGET} bytes`, () => {
    expect(bytes).toBeLessThan(BYTE_BUDGET);
  });

  it("carries no more files than the budget allows", () => {
    expect(payload.graph.files.length).toBeLessThanOrEqual(DEFAULT_LOD_BUDGET.openFiles);
  });

  it("holds its size when the repo doubles", () => {
    const bigger = mapPayload(sourceOf(100_000), { threshold: DEFAULT_LOD_THRESHOLD });

    expect(bigger.graph.files.length).toBeLessThanOrEqual(DEFAULT_LOD_BUDGET.openFiles);
    expect(bigger.graph.groupImports!.length).toBe(payload.graph.groupImports!.length);
    // Twice the repo, and only the summaries' own digits grow.
    expect(bytesOf(bigger)).toBeLessThan(BYTE_BUDGET);
    expect(bytesOf(bigger) / bytes).toBeLessThan(1.1);
  });
});

describe("lodGraph with impacted files", () => {
  const plain = sourceOf(3000);
  const graph = normaliseGraph({
    ...plain.graph,
    files: plain.graph.files.map((file, i) =>
      i % 9 === 0 && file.changed !== true ? { ...file, impacted: true } : file,
    ),
  });
  const lod = lodGraph(graph, plain.changedPaths, plain.heat, { openFiles: 400 });

  it("gives each summary the group's impacted count", () => {
    const all = clusterGraph(graph, SHUT);

    expect(lod.summaries!.some((s) => (s.impactedCount ?? 0) > 0)).toBe(true);
    for (const summary of lod.summaries!) {
      const group = all.groups.find((g) => g.id === summary.id)!;
      expect(summary.impactedCount ?? 0).toBe(group.impactedCount);
    }
  });

  it("keeps the flag on the files it sends and on a group fetched later", () => {
    const held = new Set(lod.files.map((file) => file.path));
    const target = lod.summaries!.find((s) => (s.impactedCount ?? 0) > 0)!;
    const slice = groupSlice(graph, plain.heat, target.id, held);

    expect(lod.files.some((file) => file.impacted === true)).toBe(true);
    expect(slice.graph.files.filter((f) => f.impacted === true)).toHaveLength(
      target.impactedCount!,
    );
  });

  it("adds no impacted count to the payload of a review without a blast radius", () => {
    const bare = lodGraph(normaliseGraph(plain.graph), plain.changedPaths, plain.heat, {
      openFiles: 400,
    });

    expect(bare.summaries!.every((s) => !("impactedCount" in s))).toBe(true);
  });
});

describe("groupSlice", () => {
  const source = sourceOf(3000);
  const graph = normaliseGraph(source.graph);
  const lod = lodGraph(graph, source.changedPaths, source.heat, { openFiles: 400 });
  const held = new Set(lod.files.map((file) => file.path));
  const target = lod.summaries!.find((s) => s.fileCount > 2)!;

  it("returns every file of the group and nothing else", () => {
    const slice = groupSlice(graph, source.heat, target.id, held);

    expect(slice.graph.files).toHaveLength(target.fileCount);
    expect(slice.groupId).toBe(target.id);
  });

  it("only sends edges both of whose ends the caller will have", () => {
    const slice = groupSlice(graph, source.heat, target.id, held);
    const after = new Set([...held, ...slice.graph.files.map((f) => f.path)]);

    for (const edge of slice.graph.imports) {
      expect(after.has(edge.from) && after.has(edge.to)).toBe(true);
    }
  });

  it("carries the findings of the files it sends", () => {
    const slice = groupSlice(graph, source.heat, target.id, held);
    for (const [path, counts] of Object.entries(slice.heat)) {
      expect(counts).toEqual(source.heat[path]);
    }
  });

  it("is empty for a group that does not exist", () => {
    expect(groupSlice(graph, source.heat, "nope::nowhere").graph.files).toEqual([]);
  });
});

describe("searchGroups", () => {
  const source = sourceOf(3000);
  const graph = normaliseGraph(source.graph);

  it("finds a file the level-of-detail payload left out, and names its group", () => {
    const lod = lodGraph(graph, source.changedPaths, source.heat, { openFiles: 200 });
    const sent = new Set(lod.files.map((file) => file.path));
    const hidden = graph.files.find((file) => !sent.has(file.path))!;

    const results = searchGroups(graph, hidden.path, 20);
    const hit = results.find((r) => r.path === hidden.path)!;

    expect(hit).toBeDefined();
    expect(lod.summaries!.some((s) => s.id === hit.groupId)).toBe(true);
  });

  it("honours the limit and the shared ranking", () => {
    const results = searchGroups(graph, "session", 5);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.rank)).toEqual([...results.map((r) => r.rank)].sort());
  });
});
