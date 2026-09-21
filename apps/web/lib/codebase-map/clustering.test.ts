import { describe, expect, it } from "vitest";

import { clusterGraph, directoryOf, groupIdFor } from "./clustering";
import { normaliseGraph } from "./normalise";
import type { MapViewState } from "./types";

const view = (over: Partial<MapViewState> = {}): MapViewState => ({
  focusedPath: null,
  query: "",
  expandedGroups: new Set(),
  ...over,
});

const repo = normaliseGraph({
  files: [
    { path: "apps/web/lib/a.ts", package: "web" },
    { path: "apps/web/lib/b.ts", package: "web" },
    { path: "apps/web/app/page.tsx", package: "web" },
    { path: "packages/db/src/schema.ts", package: "db" },
  ],
  imports: [
    { from: "apps/web/lib/a.ts", to: "apps/web/lib/b.ts" },
    { from: "apps/web/app/page.tsx", to: "apps/web/lib/a.ts" },
    { from: "apps/web/app/page.tsx", to: "apps/web/lib/b.ts" },
    { from: "apps/web/lib/a.ts", to: "packages/db/src/schema.ts" },
  ],
});

describe("groupIdFor", () => {
  it("keys on package then directory", () => {
    expect(groupIdFor({ path: "apps/web/lib/a.ts", package: "web" })).toBe("web::apps/web/lib");
    expect(groupIdFor({ path: "a.ts" })).toBe("-::.");
    expect(directoryOf("a/b/c.ts")).toBe("a/b");
  });

  it("separates the same directory in different packages", () => {
    expect(groupIdFor({ path: "src/a.ts", package: "one" })).not.toBe(
      groupIdFor({ path: "src/a.ts", package: "two" }),
    );
  });
});

describe("clusterGraph", () => {
  it("groups files by package then directory", () => {
    const { groups } = clusterGraph(repo, view());

    expect(groups.map((g) => [g.id, g.files.length])).toEqual([
      ["db::packages/db/src", 1],
      ["web::apps/web/app", 1],
      ["web::apps/web/lib", 2],
    ]);
  });

  it("merges imports between groups into counts and keeps internal ones out", () => {
    const { imports, groups } = clusterGraph(repo, view());

    expect(imports).toEqual([
      { from: "web::apps/web/app", to: "web::apps/web/lib", count: 2 },
      { from: "web::apps/web/lib", to: "db::packages/db/src", count: 1 },
    ]);
    expect(groups.find((g) => g.id === "web::apps/web/lib")?.internalImports).toBe(1);
  });

  it("collapses every group by default", () => {
    const { groups } = clusterGraph(repo, view());

    expect(groups.every((g) => g.collapsed)).toBe(true);
  });

  it("expands a group holding a changed file", () => {
    const changed = normaliseGraph({
      files: [
        { path: "src/a.ts", changed: true },
        { path: "other/b.ts", changed: false },
      ],
      imports: [],
    });

    const { groups } = clusterGraph(changed, view());
    expect(groups.find((g) => g.id === "-::src")?.collapsed).toBe(false);
    expect(groups.find((g) => g.id === "-::other")?.collapsed).toBe(true);
  });

  it("expands the group holding the focused file", () => {
    const { groups } = clusterGraph(repo, view({ focusedPath: "packages/db/src/schema.ts" }));

    const group = groups.find((g) => g.id === "db::packages/db/src");
    expect(group?.containsFocus).toBe(true);
    expect(group?.collapsed).toBe(false);
  });

  it("expands a group the viewer asked for", () => {
    const { groups } = clusterGraph(repo, view({ expandedGroups: new Set(["web::apps/web/app"]) }));

    expect(groups.find((g) => g.id === "web::apps/web/app")?.collapsed).toBe(false);
    expect(groups.find((g) => g.id === "web::apps/web/lib")?.collapsed).toBe(true);
  });

  it("maps every file to its group", () => {
    const { groupOfFile } = clusterGraph(repo, view());

    expect(groupOfFile.get("apps/web/lib/b.ts")).toBe("web::apps/web/lib");
    expect(groupOfFile.size).toBe(4);
  });
});
