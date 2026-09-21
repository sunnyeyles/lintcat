/**
 * The fast unit run (`pnpm test`). The evals project matches only its own
 * `*.test.ts`, which is what keeps the model-backed `*.eval.ts` files out.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*", "scripts", "evals/vitest.config.ts"],
  },
});
