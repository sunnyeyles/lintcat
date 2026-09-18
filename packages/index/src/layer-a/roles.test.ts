/** Role conventions, and the precedence between them where they overlap. */
import { describe, expect, it } from "vitest";

import { languageOf } from "./languages.js";
import { roleOf } from "./roles.js";

function role(path: string): string {
  return roleOf(path, languageOf(path));
}

describe("roleOf", () => {
  it("classifies source, test and config by convention", () => {
    expect(role("packages/ai/src/agents/tools.ts")).toBe("source");
    expect(role("packages/ai/src/agents/tools.test.ts")).toBe("test");
    expect(role("packages/ai/src/agents/tools.spec.tsx")).toBe("test");
    expect(role("src/__tests__/helper.ts")).toBe("test");
    expect(role("tests/helper.ts")).toBe("test");
    expect(role("internal/server_test.go")).toBe("test");
    expect(role("app/test_models.py")).toBe("test");
    expect(role("app/models_test.py")).toBe("test");
    expect(role("evals/src/review.eval.ts")).toBe("test");
  });

  it("puts vendored and generated ahead of test", () => {
    expect(role("node_modules/vitest/dist/index.test.js")).toBe("vendored");
    expect(role("third_party/zlib/zlib.c")).toBe("vendored");
    expect(role("dist/agents/tools.test.js")).toBe("generated");
    expect(role("apps/web/.next/static/chunk.js")).toBe("generated");
    expect(role("pnpm-lock.yaml")).toBe("generated");
    expect(role("api/service.pb.go")).toBe("generated");
    expect(role("api/service_pb2.py")).toBe("generated");
    expect(role("src/schema.generated.ts")).toBe("generated");
  });

  it("separates migrations from the generated metadata beside them", () => {
    expect(role("packages/db/drizzle/0000_sad_silver_fox.sql")).toBe("migration");
    expect(role("packages/db/drizzle/meta/_journal.json")).toBe("generated");
    expect(role("db/migrations/001_init.sql")).toBe("migration");
    expect(role("db/migrate/20240101_users.rb")).toBe("migration");
  });

  it("classifies docs, config and assets", () => {
    expect(role("README.md")).toBe("docs");
    expect(role("docs/specs/repo-index.md")).toBe("docs");
    expect(role("docs/index.html")).toBe("docs");
    expect(role("LICENSE")).toBe("docs");
    expect(role(".gitignore")).toBe("config");
    expect(role("vitest.config.ts")).toBe("config");
    expect(role("packages/index/tsconfig.json")).toBe("config");
    expect(role("packages/index/package.json")).toBe("config");
    expect(role(".github/workflows/ci.yml")).toBe("config");
    expect(role("Dockerfile")).toBe("config");
    expect(role("Makefile")).toBe("config");
    expect(role("apps/web/public/logo.svg")).toBe("asset");
    expect(role("apps/web/public/hero.png")).toBe("asset");
  });
});

describe("languageOf", () => {
  it("maps known extensions and nothing else", () => {
    expect(languageOf("src/a.ts")).toBe("typescript");
    expect(languageOf("src/a.mjs")).toBe("javascript");
    expect(languageOf("main.go")).toBe("go");
    expect(languageOf("lib.rs")).toBe("rust");
    expect(languageOf("app/models.py")).toBe("python");
    expect(languageOf("Main.kt")).toBe("kotlin");
    expect(languageOf("query.SQL")).toBe("sql");
    expect(languageOf("README.md")).toBe("markdown");
    expect(languageOf("Dockerfile")).toBeNull();
    expect(languageOf(".gitignore")).toBeNull();
    expect(languageOf("data.parquet")).toBeNull();
  });
});
