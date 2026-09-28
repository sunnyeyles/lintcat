import { describe, expect, it, vi } from "vitest";

import type { MapAdapter } from "@/components/codebase-map/adapter";
import { MapSession, type MapSessionSource } from "@/components/codebase-map/map-session";
import { mapQuery } from "@/lib/codebase-map";
import type { GroupSlice, MapGraph } from "@/lib/codebase-map";

const B = "pkg::pkg/b";
const C = "pkg::pkg/c";

const REPO: MapGraph = {
  files: [
    { path: "pkg/a/one.ts", package: "pkg", changed: true },
    { path: "pkg/a/two.ts", package: "pkg" },
    { path: "pkg/b/three.ts", package: "pkg" },
    { path: "pkg/b/four.ts", package: "pkg" },
    { path: "pkg/c/five.ts", package: "pkg" },
    { path: "pkg/c/six.ts", package: "pkg" },
  ],
  imports: [
    { from: "pkg/a/one.ts", to: "pkg/b/three.ts" },
    { from: "pkg/b/four.ts", to: "pkg/a/one.ts" },
    { from: "pkg/c/five.ts", to: "pkg/c/six.ts" },
  ],
};

const FULL: MapSessionSource = { graph: REPO, heat: {}, changedPaths: ["pkg/a/one.ts"] };

interface Deferred {
  groupId: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

// Serves real slices of REPO, but only when the test says so.
function heldAdapter() {
  const query = mapQuery(FULL);
  const requests: Deferred[] = [];
  const adapter: MapAdapter = {
    expandGroup: vi.fn(
      (groupId: string) =>
        new Promise<GroupSlice>((resolve, reject) => {
          requests.push({ groupId, resolve: () => resolve(query.expand(groupId, []) as GroupSlice), reject });
        }),
    ),
    search: async () => ({ results: [], totalFileCount: 0 }),
  };
  return { adapter, requests };
}

function lodSource(adapter: MapAdapter): MapSessionSource {
  const payload = mapQuery(FULL).first({ threshold: 0 });
  return { graph: payload.graph, heat: payload.heat, changedPaths: payload.changedPaths, adapter };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MapSession", () => {
  it("opens closed, on the change rather than the whole map", () => {
    const state = new MapSession(FULL).getSnapshot();

    expect(state.view).toEqual({
      focusedPath: null,
      query: "",
      expandedGroups: new Set(),
      showImpacted: true,
      reachDepth: 2,
      showTests: true,
    });
    expect(state.scene.byId.has("pkg/a/one.ts")).toBe(true);
    expect(state.scene.byId.has(C)).toBe(true);
    expect(state.opening).not.toBeNull();
    expect(state.opening).not.toEqual(state.scene.bounds);
    expect(state.lod).toBe(false);
  });

  it("has no opening and an empty scene without a source", () => {
    const state = new MapSession(null).getSnapshot();

    expect(state.opening).toBeNull();
    expect(state.scene.nodes).toEqual([]);
    expect(state.status.kind).toBe("empty");
  });

  it("keeps the same snapshot until something changes, and tells subscribers when it does", () => {
    const session = new MapSession(FULL);
    const listener = vi.fn();
    session.subscribe(listener);
    const first = session.getSnapshot();

    expect(session.getSnapshot()).toBe(first);
    session.setQuery("three");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).not.toBe(first);
    expect(session.getSnapshot().view.query).toBe("three");
  });

  it("opens and closes a loaded group, letting go of a focus inside it", async () => {
    const session = new MapSession(FULL);

    await session.toggleGroup(B);
    expect(session.getSnapshot().scene.byId.has("pkg/b/three.ts")).toBe(true);

    session.focus("pkg/b/three.ts");
    expect(session.getSnapshot().focusedGroupId).toBe(B);
    expect(session.getSnapshot().focusedGroupCollapsed).toBe(false);

    await session.toggleGroup(B);
    const state = session.getSnapshot();
    expect(state.view.focusedPath).toBeNull();
    expect(state.scene.byId.has(B)).toBe(true);
  });

  it("keeps a focus outside the group being closed", async () => {
    const session = new MapSession(FULL);
    await session.toggleGroup(B);
    session.focus("pkg/a/one.ts");

    await session.toggleGroup(B);
    expect(session.getSnapshot().view.focusedPath).toBe("pkg/a/one.ts");
  });

  it("steps onto the change first, then along the imports", () => {
    const session = new MapSession(FULL);

    session.step("dependencies", "next");
    expect(session.getSnapshot().view.focusedPath).toBe("pkg/a/one.ts");
    expect(session.getSnapshot().announcement).toBe(
      "pkg/a/one.ts. 1 dependencies, 1 dependents, 0 findings.",
    );

    session.step("dependencies", "next");
    expect(session.getSnapshot().view.focusedPath).toBe("pkg/b/three.ts");
  });

  it("fetches a summarised group once, shows it pending, then opens it", async () => {
    const { adapter, requests } = heldAdapter();
    const session = new MapSession(lodSource(adapter));
    expect(session.getSnapshot().lod).toBe(true);
    expect(session.getSnapshot().loadedGroups.has(C)).toBe(false);

    const first = session.toggleGroup(C);
    const second = session.toggleGroup(C);
    expect(adapter.expandGroup).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().pending).toEqual(new Set([C]));

    requests[0]!.resolve();
    await Promise.all([first, second]);

    const state = session.getSnapshot();
    expect(state.pending.size).toBe(0);
    expect(state.loadedGroups.has(C)).toBe(true);
    expect(state.view.expandedGroups.has(C)).toBe(true);
    expect(state.scene.byId.has("pkg/c/five.ts")).toBe(true);
  });

  it("focuses a file in a group it has to fetch first", async () => {
    const { adapter, requests } = heldAdapter();
    const session = new MapSession(lodSource(adapter));

    const done = session.focusFile("pkg/c/six.ts", C);
    expect(session.getSnapshot().view.focusedPath).toBeNull();
    requests[0]!.resolve();
    await done;

    expect(session.getSnapshot().view.focusedPath).toBe("pkg/c/six.ts");
  });

  it("reports a failed fetch and leaves the group shut", async () => {
    const { adapter, requests } = heldAdapter();
    const session = new MapSession(lodSource(adapter));

    const done = session.toggleGroup(C);
    requests[0]!.reject(new Error("map request failed: 500"));
    await done;

    const state = session.getSnapshot();
    expect(state.error).toBe("map request failed: 500");
    expect(state.pending.size).toBe(0);
    expect(state.loadedGroups.has(C)).toBe(false);
  });

  it("resets the view on a new source", async () => {
    const session = new MapSession(FULL);
    session.focus("pkg/a/one.ts");
    session.setQuery("one");
    await session.toggleGroup(B);

    const other: MapSessionSource = { ...FULL, graph: { ...REPO } };
    session.load(other);

    expect(session.getSnapshot().view).toEqual({
      focusedPath: null,
      query: "",
      expandedGroups: new Set(),
      showImpacted: true,
      reachDepth: 2,
      showTests: true,
    });
  });

  it("never moves a group when another one expands", async () => {
    const { adapter, requests } = heldAdapter();
    const session = new MapSession(lodSource(adapter));
    const before = session.getSnapshot().scene;
    const centreOfC = before.byId.get(C)!;

    const done = session.toggleGroup(C);
    requests[0]!.resolve();
    await done;
    const after = session.getSnapshot().scene;

    for (const node of before.nodes) {
      const same = after.byId.get(node.id);
      if (same) expect([same.x, same.y]).toEqual([node.x, node.y]);
    }
    const five = after.byId.get("pkg/c/five.ts")!;
    expect(Math.hypot(five.x - centreOfC.x, five.y - centreOfC.y)).toBeLessThanOrEqual(150.01);
  });

  it("reaches as far as asked, and counts what it reaches", () => {
    const chain: MapGraph = {
      files: [
        { path: "src/core.ts", changed: true },
        { path: "src/one.ts" },
        { path: "src/two.ts" },
        { path: "src/three.ts" },
      ],
      imports: [
        { from: "src/one.ts", to: "src/core.ts" },
        { from: "src/two.ts", to: "src/one.ts" },
        { from: "src/three.ts", to: "src/two.ts" },
      ],
    };
    const session = new MapSession({ graph: chain, heat: {}, changedPaths: ["src/core.ts"] });

    expect(session.getSnapshot().reachedCount).toBe(2);
    session.setReachDepth(3);
    expect(session.getSnapshot().reachedCount).toBe(3);
    expect(session.getSnapshot().scene.byId.get("src/three.ts")).toMatchObject({
      level: "reached",
      depth: 3,
      marker: "triangle-3",
    });
    session.setReachDepth(9);
    expect(session.getSnapshot().view.reachDepth).toBe(3);
  });

  it("hides tests on request and says how many it hid", () => {
    const withTests: MapGraph = {
      files: [
        { path: "src/a.ts", changed: true, dead: false, inCycle: false },
        { path: "src/a.test.ts", role: "test", changed: false, dead: false, inCycle: false },
      ],
      imports: [{ from: "src/a.test.ts", to: "src/a.ts" }],
    };
    const session = new MapSession({ graph: withTests, heat: {}, changedPaths: ["src/a.ts"] });

    expect(session.getSnapshot().hasTests).toBe(true);
    expect(session.getSnapshot().scene.byId.get("src/a.test.ts")?.quiet).toBe(true);
    session.setShowTests(false);

    const state = session.getSnapshot();
    expect(state.scene.byId.has("src/a.test.ts")).toBe(false);
    expect(state.scene.edges).toEqual([]);
    expect(state.status.reasons.map((reason) => reason.code)).toEqual(["tests-hidden"]);
  });

  it("discards a slice that resolves after the source changed", async () => {
    const { adapter, requests } = heldAdapter();
    const session = new MapSession(lodSource(adapter));
    const done = session.toggleGroup(C);

    const next: MapSessionSource = {
      graph: { files: [{ path: "web/app/page.tsx", package: "web", changed: true }], imports: [] },
      heat: {},
      changedPaths: ["web/app/page.tsx"],
      adapter,
    };
    session.load(next);
    expect(session.getSnapshot().pending.size).toBe(0);

    requests[0]!.resolve();
    await done;
    await flush();

    const state = session.getSnapshot();
    expect(state.graph.files.map((file) => file.path)).toEqual(["web/app/page.tsx"]);
    expect(state.view.expandedGroups.size).toBe(0);
    expect(state.pending.size).toBe(0);
    expect(state.error).toBeNull();
  });
});
