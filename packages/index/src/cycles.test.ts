/** Tarjan over the resolved import graph. */
import { describe, expect, it } from "vitest";

import { nodesInCycles } from "#src/cycles";

function graph(
  entries: readonly (readonly [string, readonly string[]])[],
): Map<string, readonly string[]> {
  return new Map(entries);
}

describe("nodesInCycles", () => {
  it("finds nothing in an empty graph", () => {
    expect([...nodesInCycles(graph([]))]).toEqual([]);
  });

  it("finds nothing in a chain", () => {
    const found = nodesInCycles(graph([["a", ["b"]], ["b", ["c"]]]));

    expect([...found]).toEqual([]);
  });

  it("finds both ends of a two-node cycle", () => {
    const found = nodesInCycles(graph([["a", ["b"]], ["b", ["a"]]]));

    expect([...found].sort()).toEqual(["a", "b"]);
  });

  it("leaves a self-loop out", () => {
    const found = nodesInCycles(graph([["a", ["a"]]]));

    expect([...found]).toEqual([]);
  });

  it("keeps a self-loop out while its neighbours cycle", () => {
    const found = nodesInCycles(
      graph([["a", ["a", "b"]], ["b", ["c"]], ["c", ["b"]]]),
    );

    expect([...found].sort()).toEqual(["b", "c"]);
  });

  it("finds every node of a longer cycle", () => {
    const found = nodesInCycles(
      graph([["a", ["b"]], ["b", ["c"]], ["c", ["a"]]]),
    );

    expect([...found].sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps two components apart", () => {
    const found = nodesInCycles(
      graph([
        ["a", ["b"]],
        ["b", ["a"]],
        ["c", ["d"]],
        ["d", ["e"]],
        ["e", ["c"]],
        ["f", ["a", "c"]],
      ]),
    );

    expect([...found].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("leaves a diamond alone", () => {
    const found = nodesInCycles(
      graph([["a", ["b", "c"]], ["b", ["d"]], ["c", ["d"]], ["d", []]]),
    );

    expect([...found]).toEqual([]);
  });

  it("counts a node that only appears as a target", () => {
    const found = nodesInCycles(graph([["a", ["b"]]]));

    expect([...found]).toEqual([]);
  });

  it("handles a deep chain without recursing", () => {
    const entries: [string, string[]][] = [];
    for (let at = 0; at < 50_000; at += 1) {
      entries.push([`f${at}`, [`f${at + 1}`]]);
    }
    entries.push([`f50000`, ["f0"]]);

    expect(nodesInCycles(graph(entries)).size).toBe(50_001);
  });
});
