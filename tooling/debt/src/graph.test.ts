import { describe, expect, it } from "vitest";

import { buildGraph, isolationViolations, packageForFile, transitiveDependents } from "#src/graph";
import type { Workspace } from "#src/workspaces";

function ws(name: string, dir: string, deps: string[] = []): Workspace {
  return { name, dir, path: `/r/${dir}`, kind: "package", dependencies: deps, external: {}, externalDev: {}, exports: ["."] };
}

describe("buildGraph", () => {
  it("computes dependents and layers", () => {
    const g = buildGraph([ws("a", "packages/a"), ws("b", "packages/b", ["a"]), ws("c", "apps/c", ["b", "a"])]);
    expect(g.nodes["a"]!.dependents).toEqual(["b", "c"]);
    expect(g.nodes["a"]!.layer).toBe(0);
    expect(g.nodes["b"]!.layer).toBe(1);
    expect(g.nodes["c"]!.layer).toBe(2);
    expect(g.cycles).toEqual([]);
  });

  it("reports a cycle once and ignores unknown dependencies", () => {
    const g = buildGraph([ws("a", "p/a", ["b", "zzz"]), ws("b", "p/b", ["a"])]);
    expect(g.cycles).toHaveLength(1);
    expect([...g.cycles[0]!].sort()).toEqual(["a", "b"]);
    expect(g.nodes["a"]!.dependencies).toEqual(["b"]);
  });

  it("reports tooling packages that depend on product packages", () => {
    const tool = { ...ws("t", "tooling/t", ["cfg", "a"]), kind: "tooling" as const };
    const g = buildGraph([ws("a", "packages/a"), ws("cfg", "packages/cfg"), tool]);
    expect(isolationViolations(g, ["cfg"])).toEqual(["t -> a"]);
    expect(isolationViolations(g, ["cfg", "a"])).toEqual([]);
  });

  it("walks dependents transitively and maps files to the deepest package", () => {
    const g = buildGraph([ws("a", "packages/a"), ws("b", "packages/b", ["a"]), ws("c", "apps/c", ["b"])]);
    expect([...transitiveDependents(g, ["a"])].sort()).toEqual(["a", "b", "c"]);
    expect(packageForFile(g, "packages/b/src/x.ts")).toBe("b");
    expect(packageForFile(g, "README.md")).toBeNull();
  });
});
