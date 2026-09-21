import type { RepositoryGraphSnapshot } from "@pr-review/index";
import type { ReviewRecordChangedFile } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import { findingHeat, mapFromSnapshot } from "@/lib/codebase-map/from-snapshot";
import type { MapSourceFinding } from "@/lib/codebase-map/from-snapshot";

type SnapshotFile = RepositoryGraphSnapshot["files"][number];

function file(path: string, extra: Partial<SnapshotFile> = {}): SnapshotFile {
  return {
    path,
    role: "source",
    language: "ts",
    importerCount: 0,
    inCycle: false,
    dead: false,
    ...extra,
  } as SnapshotFile;
}

function snapshot(over: Partial<RepositoryGraphSnapshot> = {}): RepositoryGraphSnapshot {
  return {
    sha: "base",
    truncated: false,
    files: [file("src/a.ts"), file("src/b.ts")],
    edges: [{ from: "src/a.ts", to: "src/b.ts", names: [] }],
    packages: [],
    ...over,
  };
}

function changed(
  path: string,
  status: ReviewRecordChangedFile["status"] = "modified",
): ReviewRecordChangedFile {
  return { path, status, additions: 1, deletions: 0 };
}

function found(file: string, severity: MapSourceFinding["severity"]): MapSourceFinding {
  return { file, severity };
}

describe("mapFromSnapshot", () => {
  it("joins the snapshot, the changed files and the findings", () => {
    const source = mapFromSnapshot(
      snapshot(),
      [changed("src/a.ts")],
      [found("src/a.ts", "high"), found("src/a.ts", "low"), found("src/b.ts", "medium")],
    );

    expect(source.graph?.files).toEqual([
      { path: "src/a.ts", role: "source", changed: true, dead: false, inCycle: false },
      { path: "src/b.ts", role: "source", changed: false, dead: false, inCycle: false },
    ]);
    expect(source.graph?.imports).toEqual([{ from: "src/a.ts", to: "src/b.ts" }]);
    expect(source.changedPaths).toEqual(["src/a.ts"]);
    expect(source.heat["src/a.ts"]).toEqual({ total: 2, high: 1, medium: 0, low: 1 });
    expect(source.heat["src/b.ts"]).toEqual({ total: 1, high: 0, medium: 1, low: 0 });
  });

  it("returns no graph when the snapshot is missing", () => {
    const source = mapFromSnapshot(undefined, [changed("src/a.ts")], [found("src/a.ts", "high")]);

    expect(source.graph).toBeUndefined();
    expect(source.changedPaths).toEqual([]);
    expect(source.heat["src/a.ts"]?.total).toBe(1);
  });

  it("carries an empty heat map when there are no findings", () => {
    const source = mapFromSnapshot(snapshot(), [changed("src/a.ts")], []);

    expect(source.heat).toEqual({});
    expect(source.graph?.files).toHaveLength(2);
  });

  it("adds a changed file the snapshot does not have", () => {
    const source = mapFromSnapshot(snapshot(), [changed("src/new.ts", "added")], []);

    expect(source.graph?.files.at(-1)).toEqual({ path: "src/new.ts", changed: true });
    expect(source.changedPaths).toEqual(["src/new.ts"]);
  });

  it("gives an added file the workspace package its path sits in", () => {
    const source = mapFromSnapshot(
      snapshot({ packages: [{ name: "@scope/web", root: "apps/web" }] }),
      [changed("apps/web/new.ts", "added")],
      [],
    );

    expect(source.graph?.files.at(-1)).toEqual({
      path: "apps/web/new.ts",
      changed: true,
      package: "@scope/web",
    });
  });

  it("ignores a removed file the snapshot does not have", () => {
    const source = mapFromSnapshot(snapshot(), [changed("src/gone.ts", "removed")], []);

    expect(source.graph?.files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(source.changedPaths).toEqual([]);
  });

  it("marks a removed file the snapshot still has, because the base graph holds it", () => {
    const source = mapFromSnapshot(snapshot(), [changed("src/b.ts", "removed")], []);

    expect(source.graph?.files[1]?.changed).toBe(true);
    expect(source.changedPaths).toEqual(["src/b.ts"]);
  });

  it("leaves dead and cycle flags undefined when the snapshot predates them", () => {
    const bare = { path: "src/a.ts", role: "source", language: "ts", importerCount: 0 };
    const source = mapFromSnapshot(
      snapshot({ files: [bare as SnapshotFile], edges: [] }),
      [changed("src/a.ts")],
      [],
    );

    expect(source.graph?.files[0]).toEqual({ path: "src/a.ts", role: "source", changed: true });
  });

  it("leaves every changed flag unknown when no changed file was recorded", () => {
    const source = mapFromSnapshot(snapshot(), [], []);

    expect(source.graph?.files.every((f) => f.changed === undefined)).toBe(true);
    expect(source.changedPaths).toEqual([]);
  });

  it("passes truncation through", () => {
    expect(mapFromSnapshot(snapshot({ truncated: true }), [], []).graph?.truncated).toBe(true);
    expect(mapFromSnapshot(snapshot(), [], []).graph?.truncated).toBe(false);
  });
});

describe("findingHeat", () => {
  it("skips a finding with no file", () => {
    expect(findingHeat([found("  ", "high"), found("src/a.ts", "high")])).toEqual({
      "src/a.ts": { total: 1, high: 1, medium: 0, low: 0 },
    });
  });
});
