import type { RepositoryGraphSnapshot } from "@pr-review/index";
import type { ReviewRecordChangedFile, ReviewRecordOverlay } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import { EMPHASIS_MARKERS } from "@/lib/codebase-map/emphasis";
import { groupIdFor } from "@/lib/codebase-map/clustering";
import { mapFromSnapshot } from "@/lib/codebase-map/from-snapshot";
import { normaliseGraph, type NormalisedGraph } from "@/lib/codebase-map/normalise";
import { mapQuery } from "@/lib/codebase-map/query";
import { buildScene } from "@/lib/codebase-map/scene";
import type { MapGraph, MapViewState } from "@/lib/codebase-map/types";

const GRAPH: MapGraph = {
  files: [
    { path: "pkg/a/one.ts", package: "pkg", changed: true },
    { path: "pkg/a/two.ts", package: "pkg" },
    { path: "pkg/b/three.ts", package: "pkg" },
    { path: "pkg/b/four.ts", package: "pkg" },
  ],
  imports: [
    { from: "pkg/a/one.ts", to: "pkg/b/three.ts" },
    { from: "pkg/b/four.ts", to: "pkg/a/one.ts" },
  ],
};

const graph = normaliseGraph(GRAPH);

function view(overrides: Partial<MapViewState> = {}): MapViewState {
  return { focusedPath: null, query: "", expandedGroups: new Set(), ...overrides };
}

describe("buildScene", () => {
  it("draws a collapsed group as one node and an expanded one as its files", () => {
    const scene = buildScene(graph, view());
    const ids = scene.nodes.map((node) => node.id).sort();

    // pkg/a holds the changed file, so clustering keeps it open; pkg/b stays shut.
    expect(ids).toEqual(["pkg::pkg/b", "pkg/a/one.ts", "pkg/a/two.ts"].sort());
    expect(scene.byId.get("pkg::pkg/b")?.kind).toBe("group");
    expect(scene.byId.get("pkg::pkg/b")?.fileCount).toBe(2);
  });

  it("gives every file a visible representative", () => {
    const scene = buildScene(graph, view());
    for (const file of graph.files) {
      const id = scene.representativeOf.get(file.path);
      expect(id).toBeDefined();
      expect(scene.byId.has(id!)).toBe(true);
    }
    expect(scene.representativeOf.get("pkg/b/three.ts")).toBe("pkg::pkg/b");
  });

  it("expands a group the view asks for", () => {
    const scene = buildScene(graph, view({ expandedGroups: new Set(["pkg::pkg/b"]) }));
    expect(scene.byId.has("pkg/b/three.ts")).toBe(true);
    expect(scene.byId.has("pkg::pkg/b")).toBe(false);
  });

  it("splits edges by direction around the focus", () => {
    const expandedGroups = new Set(graph.files.map(groupIdFor));
    const scene = buildScene(graph, view({ focusedPath: "pkg/a/one.ts", expandedGroups }));
    const relations = Object.fromEntries(scene.edges.map((edge) => [`${edge.a}->${edge.b}`, edge.relation]));

    expect(relations["pkg/a/one.ts->pkg/b/three.ts"]).toBe("dependency");
    expect(relations["pkg/b/four.ts->pkg/a/one.ts"]).toBe("dependent");
  });

  it("takes its markers from the emphasis module", () => {
    const expandedGroups = new Set(graph.files.map(groupIdFor));
    const scene = buildScene(graph, view({ focusedPath: "pkg/b/three.ts", expandedGroups }));

    expect(scene.byId.get("pkg/b/three.ts")?.marker).toBe(EMPHASIS_MARKERS.focus);
    expect(scene.byId.get("pkg/a/one.ts")?.marker).toBe(EMPHASIS_MARKERS.changed);
    expect(scene.byId.get("pkg/a/one.ts")?.direction).toBe("dependent");
  });

  it("puts a node in the same place every time", () => {
    const first = buildScene(graph, view());
    const second = buildScene(graph, view());
    for (const node of first.nodes) {
      const other = second.byId.get(node.id)!;
      expect([other.x, other.y]).toEqual([node.x, node.y]);
    }
  });

  it("carries finding heat onto files and sums it onto a collapsed group", () => {
    const heat = {
      "pkg/a/one.ts": { total: 1, high: 0, medium: 0, low: 1 },
      "pkg/b/three.ts": { total: 2, high: 1, medium: 1, low: 0 },
      "pkg/b/four.ts": { total: 1, high: 0, medium: 0, low: 1 },
    };
    const scene = buildScene(graph, view(), 1, heat);

    expect(scene.byId.get("pkg/a/one.ts")?.heat.top).toBe("low");
    expect(scene.byId.get("pkg/a/two.ts")?.heat.top).toBeNull();
    expect(scene.byId.get("pkg::pkg/b")?.heat.counts).toEqual({
      total: 3,
      high: 1,
      medium: 1,
      low: 1,
    });
  });

  it("leaves every node cool when no heat is given", () => {
    expect(buildScene(graph, view()).nodes.every((n) => n.heat.band === 0)).toBe(true);
  });
});

describe("buildScene with summaries", () => {
  const summarised = normaliseGraph({
    ...GRAPH,
    summaries: [
      { id: "far::far/away", fileCount: 30, changedCount: 0, heat: { total: 9, high: 2, medium: 3, low: 4 } },
    ],
    groupImports: [{ from: "pkg::pkg/b", to: "far::far/away", count: 12 }],
    totalFileCount: 34,
  });

  it("draws a summary as a node sized and heated by its counts", () => {
    const node = buildScene(summarised, view()).byId.get("far::far/away")!;

    expect(node.kind).toBe("group");
    expect(node.fileCount).toBe(30);
    expect(node.heat.counts.total).toBe(9);
    expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true);
    expect(node.label).toBe("away");
  });

  it("draws the group counts as edges, since the summary has no file edges", () => {
    const scene = buildScene(summarised, view());

    expect(scene.edges.some((e) => e.a === "pkg::pkg/b" && e.b === "far::far/away")).toBe(true);
  });

  it("adds no edge for a group whose files are on screen", () => {
    const before = buildScene(graph, view({ expandedGroups: new Set(["pkg::pkg/a"]) }));
    const ids = before.edges.map((e) => `${e.a}->${e.b}`);

    expect(ids).not.toContain("pkg::pkg/a->pkg::pkg/b");
  });
});

describe("buildScene with impacted files", () => {
  // two.ts and four.ts depend on the change; one.ts is in the list too but changed.
  const impacted = normaliseGraph({
    ...GRAPH,
    files: [
      { path: "pkg/a/one.ts", package: "pkg", changed: true, impacted: true },
      { path: "pkg/a/two.ts", package: "pkg", impacted: true },
      { path: "pkg/b/three.ts", package: "pkg" },
      { path: "pkg/b/four.ts", package: "pkg", impacted: true },
    ],
  });

  it("marks an impacted file with its own level, marker and count", () => {
    const node = buildScene(impacted, view()).byId.get("pkg/a/two.ts")!;

    expect(node.level).toBe("impacted");
    expect(node.marker).toBe(EMPHASIS_MARKERS.impacted);
    expect(node.marker).not.toBe(EMPHASIS_MARKERS.changed);
    expect(node.impactedCount).toBe(1);
  });

  it("keeps a file that is both changed and impacted changed", () => {
    const node = buildScene(impacted, view()).byId.get("pkg/a/one.ts")!;

    expect(node.level).toBe("changed");
    expect(node.changedCount).toBe(1);
    expect(node.impactedCount).toBe(0);
  });

  it("counts impacted files onto a collapsed group and ranks it impacted", () => {
    const group = buildScene(impacted, view({ reachDepth: 1 })).byId.get("pkg::pkg/b")!;
    const unreached = normaliseGraph({ files: [...impacted.files], imports: [] });

    expect(group.kind).toBe("group");
    expect(group.impactedCount).toBe(1);
    // Reach outranks impact while nothing is focused; without it the count decides.
    expect(group.level).toBe("reached");
    expect(buildScene(unreached, view()).byId.get("pkg::pkg/b")?.level).toBe("impacted");
  });

  it("ranks a summary changed over impacted, and impacted over context", () => {
    const summarised = normaliseGraph({
      ...GRAPH,
      summaries: [
        { id: "far::far/both", fileCount: 10, changedCount: 1, impactedCount: 4 },
        { id: "far::far/hit", fileCount: 10, changedCount: 0, impactedCount: 3 },
        { id: "far::far/calm", fileCount: 10, changedCount: 0 },
      ],
    });
    const scene = buildScene(summarised, view());

    expect(scene.byId.get("far::far/both")).toMatchObject({ level: "changed", impactedCount: 4 });
    expect(scene.byId.get("far::far/hit")).toMatchObject({ level: "impacted", impactedCount: 3 });
    expect(scene.byId.get("far::far/calm")).toMatchObject({ level: "context", impactedCount: 0 });
  });

  it("lets the focus neighbourhood outrank impact", () => {
    const expandedGroups = new Set(impacted.files.map(groupIdFor));
    const scene = buildScene(impacted, view({ focusedPath: "pkg/a/one.ts", expandedGroups }));

    expect(scene.byId.get("pkg/b/four.ts")?.level).toBe("neighbour");
    expect(scene.byId.get("pkg/a/two.ts")?.level).toBe("impacted");
  });

  it("hides every trace of impact when the overlay is off", () => {
    const scene = buildScene(impacted, view({ hideImpacted: true }));

    expect(scene.nodes.some((node) => node.level === "impacted")).toBe(false);
    expect(scene.nodes.every((node) => node.impactedCount === 0)).toBe(true);
    expect(scene.byId.get("pkg/a/two.ts")?.level).toBe("context");
    // four.ts imports the change, so its group is still reached; that is not impact.
    expect(scene.byId.get("pkg::pkg/b")?.level).toBe("reached");
    expect(scene.clustering.groups.find((g) => g.id === "pkg::pkg/b")?.impactedCount).toBe(1);
  });

  it("draws a map with no risk at all exactly as the hidden overlay does", () => {
    const shape = (scene: ReturnType<typeof buildScene>) =>
      scene.nodes.map((n) => [n.id, n.level, n.marker, n.x, n.y, n.impactedCount]);
    const plain = buildScene(graph, view());

    expect(plain.nodes.some((node) => node.level === "impacted")).toBe(false);
    expect(plain.clustering.groups.every((group) => group.impactedCount === 0)).toBe(true);
    expect(shape(plain)).toEqual(shape(buildScene(impacted, view({ hideImpacted: true }))));
  });
});

describe("buildScene emphasis", () => {
  const files = normaliseGraph({
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
  const levels = (target: NormalisedGraph, over: Partial<MapViewState> = {}, steps = 1) =>
    Object.fromEntries(
      buildScene(target, view({ expandedGroups: new Set(target.files.map(groupIdFor)), ...over }), steps)
        .nodes.map((node) => [node.id, node.level]),
    );

  it("gives each level its own non-colour marker", () => {
    const markers = Object.values(EMPHASIS_MARKERS);
    const scene = buildScene(files, view({ focusedPath: "src/focus.ts" }));

    expect(new Set(markers).size).toBe(markers.length);
    expect(scene.byId.get("src/focus.ts")).toMatchObject({ level: "focus", marker: EMPHASIS_MARKERS.focus });
    expect(scene.byId.get("src/elsewhere.ts")?.marker).toBe(EMPHASIS_MARKERS.dimmed);
  });

  it("treats an unnarrowed map as context, with changed files still standing out", () => {
    expect(levels(files)).toEqual({
      "src/focus.ts": "context",
      "src/uses-focus.ts": "context",
      "src/used-by-focus.ts": "context",
      "src/far.ts": "changed",
      "src/elsewhere.ts": "context",
    });
  });

  it("marks both directions of the focus neighbourhood and dims the rest", () => {
    expect(levels(files, { focusedPath: "src/focus.ts" })).toEqual({
      "src/focus.ts": "focus",
      "src/uses-focus.ts": "neighbour",
      "src/used-by-focus.ts": "neighbour",
      "src/far.ts": "changed",
      "src/elsewhere.ts": "dimmed",
    });
  });

  it("keeps search matches out of the dimmed set", () => {
    expect(levels(files, { focusedPath: "src/focus.ts", query: "elsewhere" })).toMatchObject({
      "src/elsewhere.ts": "context",
    });
  });

  it("dims everything unmatched once a query is typed", () => {
    expect(levels(files, { query: "focus" })).toEqual({
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

    expect(levels(chain, { focusedPath: "a.ts" }, 1)["c.ts"]).toBe("dimmed");
    expect(levels(chain, { focusedPath: "a.ts" }, 2)["c.ts"]).toBe("neighbour");
  });

  it("falls back to an unnarrowed map when the focus is unknown", () => {
    expect(levels(files, { focusedPath: "ghost.ts" })["src/elsewhere.ts"]).toBe("context");
  });
});

describe("buildScene neighbourhood", () => {
  it("exposes the focus's dependencies and dependents", () => {
    const scene = buildScene(graph, view({ focusedPath: "pkg/a/one.ts" }));

    expect(scene.neighbourhood.focus).toBe("pkg/a/one.ts");
    expect([...scene.neighbourhood.dependencies.keys()]).toEqual(["pkg/b/three.ts"]);
    expect([...scene.neighbourhood.dependents.keys()]).toEqual(["pkg/b/four.ts"]);
  });

  it("is empty with no focus or an unknown one", () => {
    for (const focusedPath of [null, "ghost.ts"]) {
      const { neighbourhood } = buildScene(graph, view({ focusedPath }));

      expect(neighbourhood.focus).toBeNull();
      expect(neighbourhood.dependencies.size + neighbourhood.dependents.size).toBe(0);
    }
  });
});


type SnapshotFile = RepositoryGraphSnapshot["files"][number];

function indexed(path: string, extra: Partial<SnapshotFile> = {}): SnapshotFile {
  return { path, role: "source", language: "ts", importerCount: 0, inCycle: false, dead: false, ...extra } as SnapshotFile;
}

function changedFile(
  path: string,
  status: ReviewRecordChangedFile["status"],
): ReviewRecordChangedFile {
  return { path, status, additions: 1, deletions: 1 };
}

// The one seam: stored snapshot and overlay, through the payload and normalising, to the scene.
function sceneOf(
  snapshot: RepositoryGraphSnapshot,
  changes: ReviewRecordChangedFile[],
  overlay: ReviewRecordOverlay | null | undefined,
  over: Partial<MapViewState> = {},
) {
  const source = mapFromSnapshot(snapshot, changes, [], [], overlay);
  const payload = mapQuery(source).first();
  const graph = normaliseGraph(payload.graph);
  const expandedGroups = new Set(graph.files.map(groupIdFor));
  return { graph, scene: buildScene(graph, view({ expandedGroups, ...over })) };
}

describe("buildScene with the PR drawn as merged", () => {
  const base: RepositoryGraphSnapshot = {
    sha: "base",
    truncated: false,
    files: [
      indexed("src/app.ts"),
      indexed("src/util.ts"),
      indexed("src/old-name.ts"),
      indexed("src/gone.ts"),
      indexed("src/uses-old.ts"),
    ],
    edges: [
      { from: "src/app.ts", to: "src/util.ts", names: [] },
      { from: "src/app.ts", to: "src/gone.ts", names: [] },
      { from: "src/uses-old.ts", to: "src/old-name.ts", names: [] },
    ],
    packages: [],
  };
  const changes = [
    changedFile("src/app.ts", "modified"),
    changedFile("src/new.ts", "added"),
    changedFile("src/gone.ts", "removed"),
    changedFile("src/new-name.ts", "renamed"),
  ];
  const overlay: ReviewRecordOverlay = {
    headSha: "head",
    files: [
      { path: "src/app.ts", status: "modified" },
      { path: "src/new.ts", status: "added" },
      { path: "src/gone.ts", status: "removed" },
      { path: "src/new-name.ts", status: "renamed", previousPath: "src/old-name.ts" },
    ],
    added: [
      { from: "src/new.ts", to: "src/util.ts" },
      { from: "src/app.ts", to: "src/new.ts" },
    ],
    removed: [{ from: "src/app.ts", to: "src/gone.ts" }],
    unresolvedImportCount: 0,
    partial: false,
  };
  const { graph, scene } = sceneOf(base, changes, overlay);
  const edge = (a: string, b: string) => scene.edges.find((e) => e.a === a && e.b === b);

  it("tells the four change statuses apart by shape", () => {
    const markers = ["src/app.ts", "src/new.ts", "src/gone.ts", "src/new-name.ts"].map(
      (path) => scene.byId.get(path)!,
    );

    expect(markers.map((node) => [node.change, node.level])).toEqual([
      ["modified", "changed"],
      ["added", "changed"],
      ["removed", "changed"],
      ["renamed", "changed"],
    ]);
    expect(new Set(markers.map((node) => node.marker)).size).toBe(4);
  });

  it("draws an added file with the imports it makes", () => {
    expect(edge("src/new.ts", "src/util.ts")).toMatchObject({ relation: "base", change: "added" });
    expect(edge("src/app.ts", "src/new.ts")?.change).toBe("added");
  });

  it("keeps an edge the PR removes, marked removed, and never walks it", () => {
    expect(edge("src/app.ts", "src/gone.ts")?.change).toBe("removed");
    expect(graph.outgoing.get("src/app.ts")).not.toContain("src/gone.ts");
    expect(edge("src/app.ts", "src/util.ts")?.change).toBeNull();
  });

  it("draws a rename once, at its new path, with the old path's edges", () => {
    expect(scene.byId.has("src/old-name.ts")).toBe(false);
    expect(graph.byPath.get("src/new-name.ts")?.previousPath).toBe("src/old-name.ts");
    expect(edge("src/uses-old.ts", "src/new-name.ts")).toBeDefined();
  });

  it("says the overlay is complete and draws the base alone without one", () => {
    expect(graph.overlay).toBe("complete");
    const plain = sceneOf(base, changes, undefined);
    expect(plain.graph.overlay).toBeUndefined();
    expect(plain.scene.nodes.every((node) => node.change === null)).toBe(true);
    expect(plain.scene.edges.every((e) => e.change === null)).toBe(true);
    expect(sceneOf(base, changes, null).graph.overlay).toBe("absent");
  });
});

describe("buildScene reach", () => {
  const chain = normaliseGraph({
    files: [
      { path: "src/core.ts", changed: true },
      { path: "src/one.ts" },
      { path: "src/two.ts" },
      { path: "src/three.ts" },
      { path: "src/four.ts" },
      { path: "src/below.ts" },
    ],
    imports: [
      { from: "src/one.ts", to: "src/core.ts" },
      { from: "src/two.ts", to: "src/one.ts" },
      { from: "src/three.ts", to: "src/two.ts" },
      { from: "src/four.ts", to: "src/three.ts" },
      { from: "src/core.ts", to: "src/below.ts" },
    ],
  });
  const at = (over: Partial<MapViewState> = {}) =>
    buildScene(chain, view({ expandedGroups: new Set(chain.files.map(groupIdFor)), ...over }));

  it("marks the change's dependents by depth, two steps by default", () => {
    const scene = at();

    expect(scene.byId.get("src/one.ts")).toMatchObject({ level: "reached", depth: 1, marker: "triangle-1" });
    expect(scene.byId.get("src/two.ts")).toMatchObject({ level: "reached", depth: 2, marker: "triangle-2" });
    expect(scene.byId.get("src/three.ts")).toMatchObject({ level: "context", depth: null });
    // Reach follows who imports the change, never what the change imports.
    expect(scene.byId.get("src/below.ts")?.level).toBe("context");
    expect(scene.reach.count).toBe(2);
  });

  it("widens and narrows with the chosen depth", () => {
    expect(at({ reachDepth: 1 }).reach.count).toBe(1);
    expect(at({ reachDepth: 3 }).byId.get("src/three.ts")).toMatchObject({ depth: 3, marker: "triangle-3" });
    expect(at({ reachDepth: 7 }).reach.depth).toBe(3);
  });

  it("gives way to the focus neighbourhood when a file is focused", () => {
    const scene = at({ focusedPath: "src/three.ts" });

    expect(scene.byId.get("src/two.ts")?.level).toBe("neighbour");
    expect(scene.byId.get("src/one.ts")?.level).toBe("dimmed");
  });

  it("ranks a collapsed or summarised group reached, with its count", () => {
    const summarised = normaliseGraph({
      files: [{ path: "src/core.ts", changed: true }],
      imports: [],
      summaries: [{ id: "-::far", fileCount: 9, changedCount: 0, reachedByDepth: [0, 4, 1] }],
    });
    const scene = buildScene(summarised, view());

    expect(scene.byId.get("-::far")).toMatchObject({ level: "reached", reachedCount: 4 });
    expect(buildScene(summarised, view({ reachDepth: 1 })).byId.get("-::far")?.level).toBe("context");
    expect(buildScene(summarised, view({ reachDepth: 3 })).reach.count).toBe(5);
  });
});

describe("buildScene flags", () => {
  const flagged = normaliseGraph({
    files: [
      { path: "src/a.ts", inCycle: true, dead: false },
      { path: "src/b.ts", inCycle: true, dead: false },
      { path: "src/c.ts", inCycle: false, dead: false },
      { path: "src/orphan.ts", dead: true, inCycle: false },
      { path: "src/unknown.ts" },
      { path: "src/a.test.ts", role: "test" },
      { path: "src/__fixtures__/data.ts" },
    ],
    imports: [
      { from: "src/a.ts", to: "src/b.ts" },
      { from: "src/b.ts", to: "src/a.ts" },
      { from: "src/a.ts", to: "src/c.ts" },
      { from: "src/a.test.ts", to: "src/a.ts" },
    ],
  });
  const at = (over: Partial<MapViewState> = {}) =>
    buildScene(flagged, view({ expandedGroups: new Set(flagged.files.map(groupIdFor)), ...over }));

  it("draws the edges that close a cycle as their own relation", () => {
    const relations = Object.fromEntries(at().edges.map((e) => [`${e.a}->${e.b}`, e.relation]));

    expect(relations["src/a.ts->src/b.ts"]).toBe("cycle");
    expect(relations["src/b.ts->src/a.ts"]).toBe("cycle");
    expect(relations["src/a.ts->src/c.ts"]).toBe("base");
  });

  it("lets the focus relation win over a cycle", () => {
    const scene = at({ focusedPath: "src/a.ts" });
    const edge = scene.edges.find((e) => e.a === "src/a.ts" && e.b === "src/b.ts");

    expect(edge?.relation).toBe("dependency");
  });

  it("marks a dead file, and never an unknown one", () => {
    const scene = at();

    expect(scene.byId.get("src/orphan.ts")?.dead).toBe(true);
    expect(scene.byId.get("src/unknown.ts")?.dead).toBe(false);
    expect(scene.byId.get("src/orphan.ts")?.marker).toBe(EMPHASIS_MARKERS.context);
  });

  it("draws tests and fixtures quieter at the same level", () => {
    const scene = at();

    expect(scene.byId.get("src/a.test.ts")).toMatchObject({ quiet: true, level: "context" });
    expect(scene.byId.get("src/__fixtures__/data.ts")?.quiet).toBe(true);
    expect(scene.byId.get("src/a.ts")?.quiet).toBe(false);
  });

  it("leaves hidden tests out of the scene and counts them", () => {
    const scene = at({ hideTests: true });

    expect(scene.byId.has("src/a.test.ts")).toBe(false);
    expect(scene.edges.some((e) => e.a === "src/a.test.ts")).toBe(false);
    expect(scene.hiddenTests).toBe(2);
  });
});

describe("buildScene layout", () => {
  const groups: MapGraph = {
    files: [
      { path: "a/one.ts", changed: true },
      { path: "b/two.ts" },
      { path: "c/three.ts" },
      { path: "c/four.ts" },
    ],
    imports: [
      { from: "a/one.ts", to: "b/two.ts" },
      { from: "c/three.ts", to: "c/four.ts" },
    ],
  };

  it("never moves a group when another is expanded", () => {
    const graph = normaliseGraph(groups);
    const closed = buildScene(graph, view());
    const open = buildScene(graph, view({ expandedGroups: new Set(["-::c"]) }));

    for (const node of closed.nodes) {
      const same = open.byId.get(node.id);
      if (same) expect([same.x, same.y]).toEqual([node.x, node.y]);
    }
    const group = closed.byId.get("-::c")!;
    const file = open.byId.get("c/three.ts")!;
    expect(Math.hypot(file.x - group.x, file.y - group.y)).toBeLessThanOrEqual(150.01);
  });

  it("puts a summary where the payload's layout says", () => {
    const graph = normaliseGraph({
      ...groups,
      summaries: [{ id: "-::far", fileCount: 3, changedCount: 0, at: [120, -40] }],
    });

    expect(buildScene(graph, view()).byId.get("-::far")).toMatchObject({ x: 120, y: -40 });
  });
});
