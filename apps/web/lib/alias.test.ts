import { describe, expect, it } from "vitest";

import { AGENTS } from "@pr-review/db/dashboard";

// Guards the vitest alias: without it this import fails to resolve.
describe("@/ alias", () => {
  it("resolves under vitest as well as Next", () => {
    expect(AGENTS).toContain("security");
  });
});
