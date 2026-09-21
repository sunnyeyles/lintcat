import { describe, expect, it } from "vitest";

import { normaliseGraph } from "./normalise";
import { sampleRepo } from "./sample";
import { mapStatus } from "./status";

function cycleFiles(graph: ReturnType<typeof sampleRepo>): string[] {
  return graph.files.filter((f) => f.inCycle === true).map((f) => f.path);
}

describe("sampleRepo", () => {
  it("repeats exactly for the same seed and size", () => {
    expect(sampleRepo(7, 250)).toEqual(sampleRepo(7, 250));
  });

  it("differs between seeds", () => {
    expect(sampleRepo(7, 250)).not.toEqual(sampleRepo(8, 250));
  });

  it("produces the asked-for number of unique files", () => {
    const graph = sampleRepo(3, 400);

    expect(graph.files).toHaveLength(400);
    expect(new Set(graph.files.map((f) => f.path)).size).toBe(400);
  });

  it("spreads files over packages and nested directories", () => {
    const graph = sampleRepo(3, 400);

    expect(new Set(graph.files.map((f) => f.package)).size).toBeGreaterThan(2);
    expect(graph.files.some((f) => f.path.split("/").length >= 4)).toBe(true);
  });

  it("only ever imports files it contains", () => {
    const graph = sampleRepo(5, 300);
    const normalised = normaliseGraph(graph);

    expect(normalised.dropped.unresolvedImports).toBe(0);
    expect(normalised.dropped.selfImports).toBe(0);
    expect(normalised.imports.length).toBeGreaterThan(graph.files.length / 2);
  });

  it("marks a few changed files and some dead ones", () => {
    const graph = sampleRepo(5, 300);
    const changed = graph.files.filter((f) => f.changed === true);
    const dead = graph.files.filter((f) => f.dead === true);

    expect(changed.length).toBeGreaterThan(0);
    expect(changed.length).toBeLessThan(graph.files.length / 5);
    expect(dead.length).toBeGreaterThan(0);
  });

  it("closes at least one real cycle", () => {
    const graph = sampleRepo(5, 300);
    const normalised = normaliseGraph(graph);
    const marked = cycleFiles(graph);

    expect(marked.length).toBeGreaterThanOrEqual(3);

    const returnsToItself = marked.some((path) => {
      let frontier = [path];
      for (let step = 0; step < 3; step += 1) {
        frontier = frontier.flatMap((p) => [...(normalised.outgoing.get(p) ?? [])]);
        if (frontier.includes(path)) return true;
      }
      return false;
    });
    expect(returnsToItself).toBe(true);
  });

  it("sets every flag, so the status can be ready", () => {
    const status = mapStatus(normaliseGraph(sampleRepo(5, 300)));

    expect(status.kind).toBe("ready");
    expect(status.flagCoverage).toEqual({ changed: 300, dead: 300, inCycle: 300 });
  });

  it("returns an empty graph for no files", () => {
    expect(sampleRepo(1, 0)).toEqual({ files: [], imports: [], truncated: false });
  });

  it("builds 5000 files well under a second", () => {
    const started = performance.now();
    const graph = sampleRepo(42, 5000);
    const elapsed = performance.now() - started;

    expect(graph.files).toHaveLength(5000);
    expect(graph.files.filter((f) => f.changed === true).length).toBeGreaterThan(0);
    expect(graph.files.filter((f) => f.dead === true).length).toBeGreaterThan(0);
    expect(cycleFiles(graph).length).toBeGreaterThanOrEqual(3);
    expect(elapsed).toBeLessThan(500);
  });
});
