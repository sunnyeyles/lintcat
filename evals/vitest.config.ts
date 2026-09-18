/**
 * The harness's own unit run. Matches only `*.test.ts`, so the model-backed
 * `*.eval.ts` suite can never be picked up by it.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root,
    name: "evals",
    include: ["src/**/*.test.ts"],
  },
});
