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

  it("counts unresolved imports as a partial reason", () => {
    const result = status({
      files: [known("a.ts")],
      imports: [
        { from: "a.ts", to: "ghost.ts" },
        { from: "ghost.ts", to: "a.ts" },
      ],
    });

    expect(result.kind).toBe("partial");
    expect(result.reasons).toEqual([
      {
        code: "unresolved-imports",
        count: 2,
        message: "2 imports point at files this map doesn't have.",
      },
    ]);
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
      codes({ files: [{ path: "a.ts" }], imports: [{ from: "a.ts", to: "x.ts" }], truncated: true }),
    ).toEqual([
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
  });
});
