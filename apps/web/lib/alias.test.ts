import { describe, expect, it } from "vitest";

import { AGENTS } from "@/lib/data";

// Guards the vitest alias: without it this import fails to resolve.
describe("@/ alias", () => {
  it("resolves under vitest as well as Next", () => {
    expect(AGENTS).toContain("security");
  });
});
