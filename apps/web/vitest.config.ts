import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Without this, `@/…` resolves under Next but not under vitest.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    name: "@pr-review/web",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
