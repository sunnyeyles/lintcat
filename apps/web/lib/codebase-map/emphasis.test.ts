import { describe, expect, it } from "vitest";

import { emphasise, EMPHASIS_MARKERS } from "./emphasis";
import { normaliseGraph } from "./normalise";
import type { MapViewState } from "./types";

const view = (over: Partial<MapViewState> = {}): MapViewState => ({
  focusedPath: null,
  query: "",
  expandedGroups: new Set(),
  ...over,
});

const graph = normaliseGraph({
  files: [
    { path: "src/focus.ts" },
    { path: "src/uses-focus.ts" },
    { path: "src/used-by-focus.ts" },
    { path: "src/far.ts", changed: true },
    { path: "src/elsewhere.ts" },
  ],
  imports: [
    { from: "src/uses-focus.ts", to: "src/focus.ts" },
    { from: "src/focus.ts", to: "src/used-by-focus.ts" },
  ],
});

const levels = (v: MapViewState) =>
  Object.fromEntries([...emphasise(graph, v)].map(([path, e]) => [path, e.level]));

describe("emphasise", () => {
  it("ranks every file", () => {
    expect(emphasise(graph, view()).size).toBe(graph.files.length);
  });

  it("gives each level its own non-colour marker", () => {
    const markers = Object.values(EMPHASIS_MARKERS);

    expect(new Set(markers).size).toBe(markers.length);
    expect(emphasise(graph, view({ focusedPath: "src/focus.ts" })).get("src/focus.ts")).toEqual({
      path: "src/focus.ts",
      level: "focus",
      marker: EMPHASIS_MARKERS.focus,
      rank: 0,
    });
  });

  it("treats an unnarrowed map as context, with changed files still standing out", () => {
    expect(levels(view())).toEqual({
      "src/focus.ts": "context",
      "src/uses-focus.ts": "context",
      "src/used-by-focus.ts": "context",
      "src/far.ts": "changed",
      "src/elsewhere.ts": "context",
    });
  });

  it("marks both directions of the focus neighbourhood and dims the rest", () => {
    expect(levels(view({ focusedPath: "src/focus.ts" }))).toEqual({
      "src/focus.ts": "focus",
      "src/uses-focus.ts": "neighbour",
      "src/used-by-focus.ts": "neighbour",
      "src/far.ts": "changed",
      "src/elsewhere.ts": "dimmed",
    });
  });

  it("keeps search matches out of the dimmed set", () => {
    expect(levels(view({ focusedPath: "src/focus.ts", query: "elsewhere" }))).toMatchObject({
      "src/elsewhere.ts": "context",
    });
  });

  it("dims everything unmatched once a query is typed", () => {
    expect(levels(view({ query: "focus" }))).toEqual({
      "src/focus.ts": "context",
      "src/uses-focus.ts": "context",
      "src/used-by-focus.ts": "context",
      "src/far.ts": "changed",
      "src/elsewhere.ts": "dimmed",
    });
  });

  it("reaches further when given more steps", () => {
    const chain = normaliseGraph({
      files: [{ path: "a.ts" }, { path: "b.ts" }, { path: "c.ts" }],
      imports: [
        { from: "a.ts", to: "b.ts" },
        { from: "b.ts", to: "c.ts" },
      ],
    });

    expect(emphasise(chain, view({ focusedPath: "a.ts" }), 1).get("c.ts")?.level).toBe("dimmed");
    expect(emphasise(chain, view({ focusedPath: "a.ts" }), 2).get("c.ts")?.level).toBe("neighbour");
  });

  it("falls back to an unnarrowed map when the focus is unknown", () => {
    expect(levels(view({ focusedPath: "ghost.ts" }))["src/elsewhere.ts"]).toBe("context");
  });
});

describe("emphasise with impacted files", () => {
  const hit = normaliseGraph({
    files: [
      { path: "src/focus.ts", impacted: true },
      { path: "src/uses-focus.ts", impacted: true },
      { path: "src/far.ts", changed: true, impacted: true },
      { path: "src/elsewhere.ts", impacted: true },
      { path: "src/quiet.ts" },
    ],
    imports: [{ from: "src/uses-focus.ts", to: "src/focus.ts" }],
  });
  const levelsOf = (v: MapViewState) =>
    Object.fromEntries([...emphasise(hit, v)].map(([path, e]) => [path, e.level]));

  it("ranks impact under changed and the neighbourhood, and keeps it through a focus", () => {
    expect(levelsOf(view())).toEqual({
      "src/focus.ts": "impacted",
      "src/uses-focus.ts": "impacted",
      "src/far.ts": "changed",
      "src/elsewhere.ts": "impacted",
      "src/quiet.ts": "context",
    });
    expect(levelsOf(view({ focusedPath: "src/focus.ts" }))).toEqual({
      "src/focus.ts": "focus",
      "src/uses-focus.ts": "neighbour",
      "src/far.ts": "changed",
      "src/elsewhere.ts": "impacted",
      "src/quiet.ts": "dimmed",
    });
  });

  it("reads impacted files as the rest of the map when the overlay is off", () => {
    expect(levelsOf(view({ hideImpacted: true }))).toEqual({
      "src/focus.ts": "context",
      "src/uses-focus.ts": "context",
      "src/far.ts": "changed",
      "src/elsewhere.ts": "context",
      "src/quiet.ts": "context",
    });
  });
});
