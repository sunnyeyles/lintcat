import type { ImportEdge, IndexedFile, RepositoryIndex } from "@pr-review/index";
import { computeImpact } from "@pr-review/index/impact";

import { findingHeat, mapQuery, sampleRepo } from "@/lib/codebase-map";
import type { FindingHeat, MapGraph } from "@/lib/codebase-map";

import { localMapAdapter, type MapAdapter } from "@/components/codebase-map/adapter";

export type FixtureKind = "ready" | "partial" | "no-changes" | "empty";

export const FIXTURE_LABELS: Record<FixtureKind, string> = {
  ready: "Ready",
  partial: "Partial data",
  "no-changes": "No changes",
  empty: "Empty",
};

export const FIXTURE_SIZES = [1000, 5000, 10000, 50000] as const;

/** Above the stock 5000, so the smaller sizes still draw the whole repo here. */
const DEV_LOD_THRESHOLD = 10_000;

const SEED = 7;

/** Fixtures only: the page feeds the graph, the pure module still decides the status. */
function fixtureGraph(kind: FixtureKind, files: number): MapGraph {
  if (kind === "empty") return { files: [], imports: [], truncated: false };

  const graph = sampleRepo(SEED, files);
  if (kind === "ready") return graph;

  if (kind === "no-changes") {
    return { ...graph, files: graph.files.map((file) => ({ ...file, changed: false })) };
  }

  // Two files in three lose their dead and cycle flags, so both "flagged" and "unknown" show.
  return {
    ...graph,
    files: graph.files.map((file, i) => {
      if (i % 3 === 0) return file;
      const { dead, inCycle, ...rest } = file;
      void dead;
      void inCycle;
      return rest;
    }),
  };
}

// Shaped like a stored index just enough for the blast radius; every sample file is source.
function fixtureIndex(graph: MapGraph): RepositoryIndex {
  const files = new Map<string, IndexedFile>();
  for (const file of graph.files) {
    files.set(file.path, {
      path: file.path,
      role: "source",
      language: "typescript",
      lineCount: 0,
      importerCount: 0,
      inCycle: file.inCycle === true,
      dead: file.dead === true,
    });
  }
  const edges: ImportEdge[] = graph.imports.map((edge) => ({
    from: edge.from,
    to: edge.to,
    specifier: edge.to,
    line: 1,
    names: [],
  }));
  const importers = new Map<string, ImportEdge[]>();
  for (const edge of edges) {
    const list = importers.get(edge.to!);
    if (list) list.push(edge);
    else importers.set(edge.to!, [edge]);
  }
  return {
    sha: "fixture",
    truncated: false,
    files,
    packages: [],
    coverage: [],
    edges,
    importers,
    workspace: { manifests: new Map(), byName: new Map(), packages: [], aliases: new Map() },
    docs: new Map(),
    envExamples: [],
    dependencies: [],
  };
}

/** Marks what imports the change, the way a stored `risk.dependents` would. */
function withImpact(graph: MapGraph): MapGraph {
  const changes = graph.files
    .filter((file) => file.changed === true)
    .map((file) => ({ path: file.path, status: "modified" as const }));
  const impacted = new Set(computeImpact(fixtureIndex(graph), changes).transitive);

  if (impacted.size === 0) return graph;
  return {
    ...graph,
    files: graph.files.map((file) => (impacted.has(file.path) ? { ...file, impacted: true } : file)),
  };
}

const SEVERITY_CYCLE = ["high", "medium", "low", "medium"] as const;

/** Findings on every seventh file, so the heat layer has something to draw. */
function fixtureHeat(graph: MapGraph): FindingHeat {
  const findings = graph.files.flatMap((file, i) =>
    i % 7 === 0
      ? Array.from({ length: (i % 9) + 1 }, (_, n) => ({
          file: file.path,
          severity: SEVERITY_CYCLE[(i + n) % SEVERITY_CYCLE.length]!,
        }))
      : [],
  );
  return findingHeat(findings);
}

export interface FixtureSource {
  graph: MapGraph;
  heat: FindingHeat;
  changedPaths: readonly string[];
  /** Set above the threshold, as the review page sets its endpoint. */
  adapter: MapAdapter | undefined;
}

export function fixtureSource(kind: FixtureKind, files: number): FixtureSource {
  const graph = withImpact(fixtureGraph(kind, files));
  const source = {
    graph,
    heat: fixtureHeat(graph),
    changedPaths: graph.files.filter((f) => f.changed === true).map((f) => f.path),
  };
  const query = mapQuery(source);
  const payload = query.first({ threshold: DEV_LOD_THRESHOLD });

  return {
    graph: payload.graph,
    heat: payload.heat,
    changedPaths: payload.changedPaths,
    adapter: payload.mode === "lod" ? localMapAdapter(query) : undefined,
  };
}
