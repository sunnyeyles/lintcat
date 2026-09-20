/**
 * The eval harness's own unit tests, in the fast run. Only `src` is
 * matched: `fixtures/` holds planted repositories with their own tests.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
