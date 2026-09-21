import { findingHeat, sampleRepo } from "@/lib/codebase-map";
import type { FindingHeat, MapGraph } from "@/lib/codebase-map";

export type FixtureKind = "ready" | "partial" | "no-changes" | "empty";

export const FIXTURE_LABELS: Record<FixtureKind, string> = {
  ready: "Ready",
  partial: "Partial data",
  "no-changes": "No changes",
  empty: "Empty",
};

export const FIXTURE_SIZES = [1000, 5000, 10000] as const;

const SEED = 7;

/** Fixtures only: the page feeds the graph, the pure module still decides the status. */
export function fixtureGraph(kind: FixtureKind, files: number): MapGraph {
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

const SEVERITY_CYCLE = ["high", "medium", "low", "medium"] as const;

/** Findings on every seventh file, so the heat layer has something to draw. */
export function fixtureHeat(graph: MapGraph): FindingHeat {
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
