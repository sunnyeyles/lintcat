/**
 * The fast unit run (`pnpm test`). The evals project matches only its own
 * `*.test.ts`, which is what keeps the model-backed `*.eval.ts` files out.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*", "tooling/*", "scripts", "evals/vitest.config.ts"],
    // Only `--coverage` (the debt metrics) reads this; every product source file counts, tested or not.
    coverage: {
      provider: "v8",
      include: [
        "apps/*/src/**",
        "apps/web/app/**",
        "apps/web/components/**",
        "apps/web/lib/**",
        "packages/*/src/**",
        "evals/src/**",
      ],
      exclude: ["**/*.test.{ts,tsx}", "**/*.d.ts", "**/fixtures/**", "**/node_modules/**"],
      reportsDirectory: "tooling/debt/.out/metrics/coverage",
      reporter: ["json-summary"],
      reportOnFailure: true,
    },
  },
});
