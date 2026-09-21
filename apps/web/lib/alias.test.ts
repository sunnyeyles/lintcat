import { describe, expect, it } from "vitest";

import { costOf } from "@pr-review/db/dashboard";

// Guards the vitest alias: without it this import fails to resolve.
describe("@/ alias", () => {
  it("resolves under vitest as well as Next", () => {
    expect(costOf({ inputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
