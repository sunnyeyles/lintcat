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

function oversizedIndex(oversized: readonly string[]) {
  return buildRepositoryIndex({
    sha,
    oversized,
    files: new Map([["src/a.ts", "// contents\n"]]),
  });
}

function roleOf(paths: readonly string[], path: string): string | undefined {
  return index(paths).files.get(path)?.role;
}

/** An index whose contents carry the imports, for the graph-shaped tests. */
function graphIndex(files: Record<string, string>) {
  return buildRepositoryIndex({ sha, files: new Map(Object.entries(files)) });
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

  it.each([
    ["src/review-quality.ts", "src/review-quality.eval.ts"],
    ["cmd/server/main.go", "cmd/server/main_test.go"],
    ["lib/parser.rb", "lib/parser_test.rb"],
    ["app/handler.py", "app/test_handler.py"],
    ["app/loader.py", "app/loader_test.py"],
  ])("pairs %s with %s", (source, test) => {
    const built = index([source, test]);

    expect(built.files.get(source)?.coveredBy).toBe(test);
    expect(built.files.get(test)?.covers).toBe(source);
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

  it("truncates when an oversized file was one the index would have parsed", () => {
    expect(oversizedIndex(["packages/a/src/huge.ts"]).truncated).toBe(true);
  });

  it("does not truncate when only an unindexed file was oversized", () => {
    expect(oversizedIndex(["pnpm-lock.yaml"]).truncated).toBe(false);
    expect(oversizedIndex(["fixtures/big.json"]).truncated).toBe(false);
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

describe("import cycles", () => {
  it("flags both files of a two-file cycle", () => {
    const built = graphIndex({
      "src/a.ts": 'import { b } from "./b";\nexport const a = b;\n',
      "src/b.ts": 'import { a } from "./a";\nexport const b = a;\n',
    });

    expect(built.files.get("src/a.ts")?.inCycle).toBe(true);
    expect(built.files.get("src/b.ts")?.inCycle).toBe(true);
  });

  it("does not flag a self-import", () => {
    const built = graphIndex({
      "src/a.ts": 'import { a } from "./a";\nexport const b = a;\n',
    });

    expect(built.files.get("src/a.ts")?.inCycle).toBe(false);
  });

  it("flags every file of a longer cycle and nothing outside it", () => {
    const built = graphIndex({
      "src/a.ts": 'import "./b";\n',
      "src/b.ts": 'import "./c";\n',
      "src/c.ts": 'import "./a";\n',
      "src/entry.ts": 'import "./a";\n',
    });

    expect(built.files.get("src/a.ts")?.inCycle).toBe(true);
    expect(built.files.get("src/b.ts")?.inCycle).toBe(true);
    expect(built.files.get("src/c.ts")?.inCycle).toBe(true);
    expect(built.files.get("src/entry.ts")?.inCycle).toBe(false);
  });

  it("does not flag a straight chain", () => {
    const built = graphIndex({
      "src/a.ts": 'import "./b";\n',
      "src/b.ts": 'import "./c";\n',
      "src/c.ts": "export const c = 1;\n",
    });

    expect([...built.files.values()].some((file) => file.inCycle)).toBe(false);
  });

  it("ignores an import it could not resolve", () => {
    const built = graphIndex({
      "src/a.ts": 'import "./gone";\nimport "node:fs";\n',
    });

    expect(built.files.get("src/a.ts")?.inCycle).toBe(false);
  });

  it("indexes a five thousand file chain quickly", () => {
    const files: Record<string, string> = {};
    for (let at = 0; at < 5000; at += 1) {
      files[`src/f${at}.ts`] =
        at === 4999 ? "export const end = 1;\n" : `import "./f${at + 1}";\n`;
    }
    const started = performance.now();
    const built = graphIndex(files);
    const elapsed = performance.now() - started;

    expect(built.files.size).toBe(5000);
    expect([...built.files.values()].some((file) => file.inCycle)).toBe(false);
    expect(elapsed).toBeLessThan(10_000);
  });
});

describe("dead files", () => {
  it("flags a source file nobody imports", () => {
    const built = graphIndex({ "src/orphan.ts": "export const gone = 1;\n" });

    expect(built.files.get("src/orphan.ts")?.dead).toBe(true);
  });

  it("does not flag a file something imports", () => {
    const built = graphIndex({
      "src/a.ts": 'import "./b";\n',
      "src/b.ts": "export const b = 1;\n",
    });

    expect(built.files.get("src/b.ts")?.dead).toBe(false);
  });

  it("does not flag an orphan entry point", () => {
    const built = graphIndex({
      "package.json": JSON.stringify({ name: "acme", main: "./src/main.ts" }),
      "src/main.ts": "export const main = 1;\n",
      "src/orphan.ts": "export const gone = 1;\n",
    });

    expect(built.files.get("src/main.ts")?.dead).toBe(false);
    expect(built.files.get("src/orphan.ts")?.dead).toBe(true);
  });

  it("never flags a test file", () => {
    const built = graphIndex({
      "src/a.test.ts": 'import "./a";\n',
      "src/a.ts": "export const a = 1;\n",
    });

    expect(built.files.get("src/a.test.ts")?.dead).toBe(false);
  });

  it("never flags a file of a non-source role", () => {
    const built = index([
      "README.md",
      "vitest.config.ts",
      "drizzle/0001_init.sql",
      "public/logo.svg",
    ]);

    expect([...built.files.values()].some((file) => file.dead)).toBe(false);
  });

  it("does not flag a framework route file", () => {
    const built = graphIndex({
      "app/dashboard/page.tsx": "export default function Page() {}\n",
    });

    expect(built.files.get("app/dashboard/page.tsx")?.dead).toBe(false);
  });

  it("does not flag a file a cycle keeps alive", () => {
    const built = graphIndex({
      "src/a.ts": 'import "./b";\n',
      "src/b.ts": 'import "./a";\n',
    });

    expect(built.files.get("src/a.ts")?.dead).toBe(false);
  });
});
