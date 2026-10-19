import { describe, expect, it } from "vitest";

import { packagesFromFiles } from "#src/affected";
import { buildGraph } from "#src/graph";
import type { Workspace } from "#src/workspaces";

function ws(name: string, dir: string, deps: string[] = []): Workspace {
  return { name, dir, path: dir, kind: "package", dependencies: deps, external: {}, externalDev: {}, exports: ["."] };
}

const graph = buildGraph([ws("a", "packages/a"), ws("b", "packages/b", ["a"]), ws("c", "apps/c", ["b"]), ws("d", "apps/d")]);

describe("packagesFromFiles", () => {
  it("maps changed files to their package plus every dependent", () => {
    expect(packagesFromFiles(graph, ["packages/a/src/x.ts"])).toEqual(["a", "b", "c"]);
    expect(packagesFromFiles(graph, ["apps/d/src/y.ts", "docs/readme.md"])).toEqual(["d"]);
    expect(packagesFromFiles(graph, [])).toEqual([]);
  });

  it("widens to everything when a repo-wide file changes", () => {
    expect(packagesFromFiles(graph, ["pnpm-lock.yaml"])).toBe("all");
    expect(packagesFromFiles(graph, ["tooling/debt/debt.config.json"])).toBe("all");
    expect(packagesFromFiles(graph, [".github/workflows/ci.yml"])).toBe("all");
  });
});
