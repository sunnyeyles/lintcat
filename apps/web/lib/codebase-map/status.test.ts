import { describe, expect, it } from "vitest";

import { normaliseGraph } from "./normalise";
import { mapStatus } from "./status";
import type { MapFile, MapGraph } from "./types";

const known = (path: string, over: Partial<MapFile> = {}): MapFile => ({
  path,
  changed: false,
  dead: false,
  inCycle: false,
  ...over,
});

const status = (graph: MapGraph) => mapStatus(normaliseGraph(graph));
const codes = (graph: MapGraph) => status(graph).reasons.map((r) => r.code);

describe("mapStatus", () => {
  it("reports empty for no files", () => {
    expect(status({ files: [], imports: [] }).kind).toBe("empty");
  });

  it("reports ready when every flag is known and something changed", () => {
    const result = status({
      files: [known("a.ts", { changed: true }), known("b.ts")],
      imports: [{ from: "a.ts", to: "b.ts" }],
    });

    expect(result.kind).toBe("ready");
    expect(result.reasons).toEqual([]);
    expect(result.changedCount).toBe(1);
  });

  it("reports no-changes only when the changed flag is known everywhere", () => {
    expect(status({ files: [known("a.ts"), known("b.ts")], imports: [] }).kind).toBe("no-changes");
  });

  it("never reports no-changes from an absent flag", () => {
    const result = status({ files: [{ path: "a.ts" }], imports: [] });

    expect(result.kind).toBe("partial");
    expect(result.changedCount).toBe(0);
    expect(codes({ files: [{ path: "a.ts" }], imports: [] })).toContain("unknown-changed-flags");
  });

  it("says dead and cycle data is unknown rather than clean", () => {
    const result = status({ files: [known("a.ts", { dead: undefined })], imports: [] });

    expect(result.kind).toBe("partial");
    expect(result.reasons.map((r) => r.code)).toEqual(["unknown-dead-flags"]);
    expect(result.reasons[0]?.message).toContain("unknown");
    expect(result.reasons[0]?.message).not.toMatch(/no dead/i);
  });

  it("reads unresolved imports from the index's count, not from dropped edges", () => {
    const result = status({
      files: [known("a.ts")],
      imports: [
        { from: "a.ts", to: "ghost.ts" },
        { from: "ghost.ts", to: "a.ts" },
      ],
      unresolvedImportCount: 7,
    });

    expect(result.kind).toBe("partial");
    expect(result.reasons).toEqual([
      {
        code: "unresolved-imports",
        count: 7,
        message: "7 imports the indexer could not resolve, so those edges are missing.",
      },
    ]);
  });

  it("stays quiet about unresolved imports nothing counted", () => {
    expect(codes({ files: [known("a.ts")], imports: [{ from: "a.ts", to: "ghost.ts" }] })).toEqual([]);
  });

  it("says when the PR overlay is missing or covers only part of the change", () => {
    expect(codes({ files: [known("a.ts")], imports: [], overlay: "absent" })).toEqual([
      "overlay-missing",
    ]);
    const partial = status({
      files: [known("a.ts", { changed: true, change: "added" }), known("b.ts", { changed: true })],
      imports: [],
      overlay: "partial",
    });
    expect(partial.reasons).toEqual([
      {
        code: "overlay-partial",
        count: 1,
        message: "The PR overlay covers only some of the changed files (1 drawn as merged).",
      },
    ]);
    expect(codes({ files: [known("a.ts")], imports: [], overlay: "complete" })).toEqual([]);
  });

  it("says how many group edges the payload budget left out", () => {
    const result = status({ files: [known("a.ts")], imports: [], groupImportsDropped: 12 });

    expect(result.reasons).toEqual([
      {
        code: "group-imports-capped",
        count: 12,
        message: "12 group edges left out to keep the map small, so some coupling is not drawn.",
      },
    ]);
  });

  it("counts the test files the view hid", () => {
    const result = mapStatus(normaliseGraph({ files: [known("a.ts")], imports: [] }), 3);

    expect(result.kind).toBe("partial");
    expect(result.reasons).toEqual([
      { code: "tests-hidden", count: 3, message: '3 test files hidden. Turn on "Show tests" to see them.' },
    ]);
  });

  it("counts a partial group's changed files once", () => {
    const result = status({
      files: [known("lib/a.ts", { changed: true })],
      imports: [],
      summaries: [{ id: "-::lib", fileCount: 900, changedCount: 4 }],
    });

    expect(result.changedCount).toBe(4);
  });

  it("flags a truncated index", () => {
    expect(codes({ files: [known("a.ts")], imports: [], truncated: true })).toEqual(["truncated"]);
  });

  it("prefers partial over no-changes while a caveat stands", () => {
    const result = status({ files: [known("a.ts")], imports: [], truncated: true });

    expect(result.kind).toBe("partial");
    expect(result.changedCount).toBe(0);
    expect(result.reasons.map((r) => r.code)).toEqual(["truncated"]);
  });

  it("lists every reason it has", () => {
    expect(
      codes({
        files: [{ path: "a.ts" }],
        imports: [],
        truncated: true,
        overlay: "absent",
        groupImportsDropped: 1,
        unresolvedImportCount: 2,
      }),
    ).toEqual([
      "overlay-missing",
      "group-imports-capped",
      "unresolved-imports",
      "truncated",
      "unknown-changed-flags",
      "unknown-dead-flags",
      "unknown-cycle-flags",
    ]);
  });

  it("reports flag coverage per flag", () => {
    const result = status({
      files: [known("a.ts"), { path: "b.ts", changed: true }],
      imports: [],
    });

    expect(result.flagCoverage).toEqual({ changed: 2, dead: 1, inCycle: 1 });
    expect(result.fileCount).toBe(2);
    expect(result.totalFileCount).toBe(2);
  });

  it("says so when summaries stand in for most of the repo", () => {
    const result = status({
      files: [known("a.ts")],
      imports: [],
      summaries: [{ id: "-::lib", fileCount: 900, changedCount: 4 }],
      totalFileCount: 901,
    });

    expect(result.reasons[0]).toEqual({
      code: "level-of-detail",
      count: 901,
      message: "Large repo: showing packages, expand to see files.",
    });
    expect(result.fileCount).toBe(1);
    expect(result.totalFileCount).toBe(901);
    expect(result.changedCount).toBe(4);
  });
});
