import { describe, expect, it } from "vitest";

import { clusterGraph, groupIdParts } from "./clustering";
import { findingHeat, type FindingHeat, type MapSourceFinding } from "./from-snapshot";
import { DEFAULT_LOD_THRESHOLD, lodGraph, resolveLodThreshold } from "./lod";
import { normaliseGraph } from "./normalise";
import { mapQuery } from "./query";
import { sampleRepo } from "./sample";
import type { MapGraph, MapViewState } from "./types";

const SEED = 7;
const SHUT: MapViewState = { focusedPath: null, query: "", expandedGroups: new Set() };

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

describe("resolveLodThreshold", () => {
  it("falls back to the default, then env, then the caller's override", () => {
    expect(resolveLodThreshold(undefined)).toBe(DEFAULT_LOD_THRESHOLD);
    expect(resolveLodThreshold("")).toBe(DEFAULT_LOD_THRESHOLD);
    expect(resolveLodThreshold("not a number")).toBe(DEFAULT_LOD_THRESHOLD);
    expect(resolveLodThreshold("120")).toBe(120);
    expect(resolveLodThreshold("120", 7)).toBe(7);
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

describe("lodGraph with impacted files", () => {
  const plain = sourceOf(3000);
  const impacted = {
    ...plain.graph,
    files: plain.graph.files.map((file, i) =>
      i % 9 === 0 && file.changed !== true ? { ...file, impacted: true } : file,
    ),
  };
  const graph = normaliseGraph(impacted);
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
    const target = lod.summaries!.find((s) => (s.impactedCount ?? 0) > 0)!;
    const source = { graph: impacted, heat: plain.heat, changedPaths: [] };
    const slice = mapQuery(source).expand(target.id, [])!;

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

describe("lodGraph budget and reach", () => {
  // One directory far past the budget, holding the change, and a small one beside it.
  const big: MapGraph = {
    files: [
      ...Array.from({ length: 40 }, (_, i) => ({
        path: `huge/f${String(i).padStart(2, "0")}.ts`,
        changed: i === 0,
      })),
      { path: "small/a.ts", changed: false },
      { path: "small/b.ts", changed: false },
      { path: "far/x.ts", changed: false },
    ],
    imports: [
      { from: "huge/f01.ts", to: "huge/f00.ts" },
      { from: "huge/f02.ts", to: "huge/f01.ts" },
      { from: "small/a.ts", to: "huge/f00.ts" },
      { from: "far/x.ts", to: "small/a.ts" },
    ],
  };
  const graph = normaliseGraph(big);
  const lod = lodGraph(graph, ["huge/f00.ts"], {}, { openFiles: 5 });
  const sent = (path: string) => lod.files.some((file) => file.path === path);

  it("sends an oversized group's changed and reached files, and keeps its summary", () => {
    expect(sent("huge/f00.ts")).toBe(true);
    expect(sent("huge/f01.ts")).toBe(true);
    expect(sent("huge/f39.ts")).toBe(false);
    expect(lod.summaries!.find((s) => s.id === "-::huge")?.fileCount).toBe(40);

    const merged = clusterGraph(normaliseGraph(lod), SHUT);
    expect(merged.groups.find((g) => g.id === "-::huge")).toMatchObject({
      loaded: false,
      changedCount: 1,
    });
  });

  it("never lets the first group opened blow the budget", () => {
    expect(lod.files.filter((file) => file.changed !== true).length).toBeLessThanOrEqual(5);
  });

  it("carries the server's reach on files and summaries", () => {
    expect(lod.files.find((file) => file.path === "huge/f02.ts")?.reach).toBe(2);
    expect(lod.summaries!.find((s) => s.id === "-::far")?.reachedByDepth).toEqual([0, 1, 0]);
  });

  it("places every group, summaries included", () => {
    const summarised = lod.summaries!.map((s) => s.id);
    expect(lod.summaries!.every((s) => s.at !== undefined)).toBe(true);
    expect(Object.keys(normaliseGraph(lod).groupPositions!).sort()).toEqual(
      [...new Set([...summarised, ...Object.keys(lod.groupPositions!)])].sort(),
    );
  });

  it("counts the group edges the budget left out", () => {
    const capped = lodGraph(graph, ["huge/f00.ts"], {}, { openFiles: 5, groupImports: 1 });

    expect(capped.groupImports).toHaveLength(1);
    expect(capped.groupImportsDropped).toBeGreaterThan(0);
  });
});
