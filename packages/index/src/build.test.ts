/** The pure builder, over inline file maps. */
import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import { classifyFileRole, ROLE_PRECEDENCE } from "#src/roles";
import { coveredSourcePaths } from "#src/pairing";

const sha = "0000000000000000000000000000000000000000";

/** Contents never matter in this ticket, only the paths. */
function index(paths: readonly string[], truncated = false) {
  return buildRepositoryIndex({
    sha,
    truncated,
    files: new Map(paths.map((path) => [path, "// contents\n"])),
  });
}

function roleOf(paths: readonly string[], path: string): string | undefined {
  return index(paths).files.get(path)?.role;
}

describe("classifyFileRole", () => {
  it.each([
    ["src/sessions.ts", "source"],
    ["src/sessions.test.ts", "test"],
    ["src/sessions.spec.tsx", "test"],
    ["src/__tests__/sessions.ts", "test"],
    ["pkg/handler_test.go", "test"],
    ["app/test_handler.py", "test"],
    ["package.json", "config"],
    ["tsconfig.base.json", "config"],
    ["vitest.config.ts", "config"],
    [".github/workflows/ci.yml", "config"],
    ["Dockerfile", "config"],
    ["drizzle/0001_silly_magma.sql", "migration"],
    ["db/migrations/0002_add_users.sql", "migration"],
    ["dist/index.mjs", "generated"],
    ["pnpm-lock.yaml", "generated"],
    ["src/schema.generated.ts", "generated"],
    ["types/api.d.ts", "generated"],
    ["node_modules/pkg/index.js", "vendored"],
    ["vendor/lib/thing.go", "vendored"],
    ["README.md", "docs"],
    ["docs/architecture.md", "docs"],
    ["LICENSE", "docs"],
    ["app/globals.css", "asset"],
    ["public/logo.svg", "asset"],
  ])("classifies %s as %s", (path, role) => {
    expect(classifyFileRole(path)).toBe(role);
  });

  it("states a precedence covering every role", () => {
    expect([...ROLE_PRECEDENCE].sort()).toEqual(
      [
        "asset",
        "config",
        "docs",
        "generated",
        "migration",
        "source",
        "test",
        "vendored",
      ],
    );
  });

  it.each([
    ["vendored beats test", "vendor/lib/thing.test.ts", "vendored"],
    ["generated beats test", "dist/thing.test.js", "generated"],
    ["migration beats config", "drizzle/meta/_journal.json", "migration"],
    ["test beats config", "tests/fixtures/settings.json", "test"],
    ["config beats docs", "docs/openapi.yaml", "config"],
    ["docs beats asset", "docs/diagram.svg", "docs"],
  ])("%s", (_name, path, role) => {
    expect(classifyFileRole(path)).toBe(role);
  });
});

describe("test to source pairing", () => {
  it("pairs foo.test.ts with the sibling foo.ts", () => {
    const built = index(["src/sessions.ts", "src/sessions.test.ts"]);

    expect(built.files.get("src/sessions.ts")?.coveredBy).toBe(
      "src/sessions.test.ts",
    );
    expect(built.files.get("src/sessions.test.ts")?.covers).toBe(
      "src/sessions.ts",
    );
  });

  it("pairs foo.spec.ts with the sibling foo.ts", () => {
    const built = index(["src/sessions.ts", "src/sessions.spec.ts"]);

    expect(built.files.get("src/sessions.ts")?.coveredBy).toBe(
      "src/sessions.spec.ts",
    );
  });

  it("pairs __tests__/foo.ts with the source one level up", () => {
    const built = index(["src/sessions.ts", "src/__tests__/sessions.ts"]);

    expect(built.files.get("src/sessions.ts")?.coveredBy).toBe(
      "src/__tests__/sessions.ts",
    );
  });

  it("pairs __tests__/foo.test.ts with the source one level up", () => {
    const built = index(["src/sessions.ts", "src/__tests__/sessions.test.ts"]);

    expect(built.files.get("src/sessions.ts")?.coveredBy).toBe(
      "src/__tests__/sessions.test.ts",
    );
  });

  it("pairs a .test.ts with a .tsx source when no .ts exists", () => {
    const built = index(["src/Card.tsx", "src/Card.test.ts"]);

    expect(built.files.get("src/Card.tsx")?.coveredBy).toBe("src/Card.test.ts");
  });

  it("leaves an uncovered source without a test", () => {
    const built = index(["src/sessions.ts", "src/other.test.ts"]);

    expect(built.files.get("src/sessions.ts")?.coveredBy).toBeUndefined();
    expect(built.files.get("src/other.test.ts")?.covers).toBeUndefined();
  });

  it("never pairs a test with itself", () => {
    expect(coveredSourcePaths("src/__tests__/sessions.ts")).not.toContain(
      "src/__tests__/sessions.ts",
    );
  });

  it("keeps the first test when two could cover one source", () => {
    const built = index([
      "src/sessions.ts",
      "src/sessions.spec.ts",
      "src/sessions.test.ts",
    ]);

    // Paths are sorted, so the pairing does not depend on archive order.
    expect(built.files.get("src/sessions.ts")?.coveredBy).toBe(
      "src/sessions.spec.ts",
    );
  });
});

describe("buildRepositoryIndex", () => {
  it("carries the commit it was built from", () => {
    expect(index(["src/a.ts"]).sha).toBe(sha);
  });

  it("reports every language it saw, commonest first", () => {
    const built = index([
      "src/a.ts",
      "src/b.ts",
      "app/main.py",
      "README.md",
      "Makefile",
    ]);

    expect(built.coverage).toEqual([
      {
        language: "typescript",
        files: 2,
        indexed: true,
        resolution: { internal: 0, resolved: 0, rate: 1 },
      },
      { language: "markdown", files: 1, indexed: false },
      { language: "other", files: 1, indexed: false },
      { language: "python", files: 1, indexed: false },
    ]);
  });

  it("reports a language it cannot parse as seen but not indexed", () => {
    const built = index(["cmd/server/main.go", "cmd/server/main_test.go"]);

    expect(built.coverage).toEqual([
      { language: "go", files: 2, indexed: false },
    ]);
  });

  it("propagates truncation from the archive", () => {
    expect(index(["src/a.ts"], true).truncated).toBe(true);
    expect(index(["src/a.ts"]).truncated).toBe(false);
  });

  it("indexes an empty repository without failing", () => {
    const built = index([]);

    expect(built.files.size).toBe(0);
    expect(built.coverage).toEqual([]);
  });

  it("indexes every path it was given", () => {
    expect(roleOf(["packages/db/src/schema.ts"], "packages/db/src/schema.ts")).toBe(
      "source",
    );
  });
});
