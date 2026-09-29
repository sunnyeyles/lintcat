import { describe, expect, it } from "vitest";

import { changedPaths } from "#src/changed-paths";

describe("changedPaths", () => {
  it("names every changed file and both sides of a rename", () => {
    const paths = changedPaths([
      { filename: "src/a.ts", status: "modified", additions: 1, deletions: 0 },
      {
        filename: "src/new-name.ts",
        previous_filename: "src/old-name.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
      },
    ]);

    expect([...paths].sort()).toEqual(["src/a.ts", "src/new-name.ts", "src/old-name.ts"]);
  });
});
