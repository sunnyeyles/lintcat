import type { ReviewMapInputs } from "@pr-review/db";
import type { RepositoryGraphSnapshot } from "@pr-review/index";
import { describe, expect, it, vi } from "vitest";

import { createMapSourceLoader, type MapSourceDeps } from "@/lib/data/map-source";

const SNAPSHOT: RepositoryGraphSnapshot = {
  sha: "base",
  truncated: false,
  files: [
    { path: "src/a.ts", role: "source", language: "ts", lineCount: 1, importerCount: 0, inCycle: false, dead: false },
  ],
  edges: [],
  packages: [],
};

function inputs(over: Partial<ReviewMapInputs> = {}): ReviewMapInputs {
  return {
    changedFiles: [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 0 }],
    overlay: null,
    dependents: [],
    findings: [{ file: "src/a.ts", severity: "high" }],
    ...over,
  };
}

function deps(over: Partial<MapSourceDeps> = {}): MapSourceDeps {
  return {
    access: async () => ({ repoId: 3, baseSha: "base" }),
    baseGraph: vi.fn(async () => SNAPSHOT),
    reviewInputs: vi.fn(async () => inputs()),
    ...over,
  };
}

describe("createMapSourceLoader", () => {
  it("reads nothing cached for a reader the access check refuses", async () => {
    const refused = deps({ access: async () => null });

    expect(await createMapSourceLoader(refused)(7)).toBeUndefined();
    expect(refused.baseGraph).not.toHaveBeenCalled();
    expect(refused.reviewInputs).not.toHaveBeenCalled();
  });

  it("keys the base graph by repo and base, and the rest by review", async () => {
    const wired = deps();
    const source = await createMapSourceLoader(wired)(7);

    expect(wired.baseGraph).toHaveBeenCalledWith(3, "base");
    expect(wired.reviewInputs).toHaveBeenCalledWith(7);
    expect(source?.heat["src/a.ts"]?.high).toBe(1);
    expect(source?.changedPaths).toEqual(["src/a.ts"]);
  });

  it("says the overlay is missing when the review changed files but stored none", async () => {
    const source = await createMapSourceLoader(deps())(7);

    expect(source?.graph?.overlay).toBe("absent");
  });

  it("claims no missing overlay when there was no PR to overlay", async () => {
    const empty = deps({ reviewInputs: async () => inputs({ changedFiles: [] }) });

    expect((await createMapSourceLoader(empty)(7))?.graph).not.toHaveProperty("overlay");
  });

  it("has no graph for a review stored without a base", async () => {
    const baseless = deps({ access: async () => ({ repoId: 3, baseSha: null }) });
    const source = await createMapSourceLoader(baseless)(7);

    expect(source?.graph).toBeUndefined();
    expect(baseless.baseGraph).not.toHaveBeenCalled();
  });
});
