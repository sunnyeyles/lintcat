import { describe, expect, it } from "vitest";

import { findLintConfigs } from "#src/lint-config";

describe("findLintConfigs", () => {
  it("names each linter, formatter and typecheck config, shallowest first", () => {
    const configs = findLintConfigs(
      new Map([
        ["packages/web/eslint.config.mjs", "export default [];\n"],
        [".prettierrc.json", '{ "singleQuote": false }\n'],
        ["tsconfig.json", '{ "compilerOptions": { "strict": true } }\n'],
        ["biome.json", "{}\n"],
        ["src/index.ts", "export {};\n"],
        [".github/workflows/ci.yml", "on: push\n"],
      ]),
    );

    expect(configs.map(({ tool, path }) => [tool, path])).toEqual([
      ["Prettier", ".prettierrc.json"],
      ["Biome", "biome.json"],
      ["TypeScript", "tsconfig.json"],
      ["ESLint", "packages/web/eslint.config.mjs"],
    ]);
    expect(configs[0]?.excerpt).toBe('{ "singleQuote": false }');
  });

  it("keeps only the lint, format and typecheck scripts of a package.json", () => {
    const [scripts] = findLintConfigs(
      new Map([
        [
          "package.json",
          JSON.stringify({
            scripts: { build: "tsc -p .", lint: "eslint .", "format:check": "prettier --check ." },
          }),
        ],
      ]),
    );

    expect(scripts).toEqual({
      tool: "package.json scripts",
      path: "package.json",
      excerpt: "lint: eslint .\nformat:check: prettier --check .",
    });
  });

  it("skips a package.json or pyproject.toml that configures no such tool", () => {
    expect(
      findLintConfigs(
        new Map([
          ["package.json", JSON.stringify({ scripts: { start: "node ." } })],
          ["broken/package.json", "{"],
          ["pyproject.toml", '[project]\nname = "x"\n'],
        ]),
      ),
    ).toEqual([]);
  });

  it("keeps only the linter sections of a pyproject.toml", () => {
    const [config] = findLintConfigs(
      new Map([
        [
          "pyproject.toml",
          '[project]\nname = "x"\n\n[tool.ruff]\nline-length = 100\n\n[tool.pytest.ini_options]\naddopts = "-q"\n',
        ],
      ]),
    );

    expect(config).toEqual({
      tool: "pyproject.toml tools",
      path: "pyproject.toml",
      excerpt: "[tool.ruff]\nline-length = 100",
    });
  });

  it("cuts a long config to an excerpt", () => {
    const [config] = findLintConfigs(new Map([[".editorconfig", "x".repeat(5_000)]]));
    expect(config?.excerpt.length).toBeLessThan(5_000);
  });
});
