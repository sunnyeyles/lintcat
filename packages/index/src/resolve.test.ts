/** Alias resolution, over inline file maps: import maps, tsconfig paths, packages. */
import { describe, expect, it } from "vitest";

import { buildRepositoryIndex, type ImportEdge } from "#src/build";
import { parseWorkspaceYamlPackages } from "#src/manifests";

const sha = "0000000000000000000000000000000000000000";

function index(files: Record<string, string>) {
  return buildRepositoryIndex({
    sha,
    files: new Map(Object.entries(files)),
  });
}

function edgesOf(files: Record<string, string>, from: string): ImportEdge[] {
  return index(files).edges.filter((edge) => edge.from === from);
}

/** Where the one import in `from` lands, or undefined when nothing matches. */
function targetOf(files: Record<string, string>, from: string) {
  return edgesOf(files, from)[0]?.to;
}

function typescriptResolution(files: Record<string, string>) {
  return index(files).coverage.find((entry) => entry.language === "typescript")
    ?.resolution;
}

const PNPM_WORKSPACE = "packages:\n  - packages/*\n";

describe("# import maps", () => {
  const files = {
    "packages/app/package.json": JSON.stringify({
      name: "@acme/app",
      imports: { "#src/*": "./src/*.ts" },
    }),
    "packages/app/src/main.ts": 'import { helper } from "#src/lib/helper";\n',
    "packages/app/src/lib/helper.ts": "export const helper = 1;\n",
  };

  it("resolves a # specifier through the nearest package's imports map", () => {
    expect(targetOf(files, "packages/app/src/main.ts")).toBe(
      "packages/app/src/lib/helper.ts",
    );
  });

  it("counts an unmatched # specifier as internal, not third-party", () => {
    const resolution = typescriptResolution({
      ...files,
      "packages/app/src/main.ts": 'import x from "#src/missing";\n',
    });

    expect(resolution).toEqual({ internal: 1, resolved: 0, rate: 0 });
  });

  it("reads a conditional import map through its import branch", () => {
    expect(
      targetOf(
        {
          ...files,
          "packages/app/package.json": JSON.stringify({
            name: "@acme/app",
            imports: {
              "#src/*": { types: "./types/*.d.ts", import: "./src/*.ts" },
            },
          }),
        },
        "packages/app/src/main.ts",
      ),
    ).toBe("packages/app/src/lib/helper.ts");
  });
});

describe("tsconfig paths", () => {
  const web = {
    "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
    "apps/web/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./*"] } },
    }),
    "apps/web/app/page.tsx": 'import { db } from "@/lib/db";\n',
    "apps/web/lib/db.ts": "export const db = 1;\n",
  };

  it("resolves an alias declared in the nearest tsconfig", () => {
    expect(targetOf(web, "apps/web/app/page.tsx")).toBe("apps/web/lib/db.ts");
  });

  it("follows an extends chain to the config that declares paths", () => {
    const files = {
      "tsconfig.base.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "~/*": ["shared/*"] } },
      }),
      "apps/web/tsconfig.json": JSON.stringify({
        extends: "../../tsconfig.base.json",
      }),
      "apps/web/app/page.tsx": 'import { log } from "~/log";\n',
      "shared/log.ts": "export const log = 1;\n",
    };

    expect(targetOf(files, "apps/web/app/page.tsx")).toBe("shared/log.ts");
  });

  it("rebases targets onto baseUrl when the config sets one", () => {
    const files = {
      "apps/web/tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: "src", paths: { "@/*": ["./*"] } },
      }),
      "apps/web/app.ts": 'import { db } from "@/lib/db";\n',
      "apps/web/src/lib/db.ts": "export const db = 1;\n",
    };

    expect(targetOf(files, "apps/web/app.ts")).toBe("apps/web/src/lib/db.ts");
  });

  it("takes the pattern with the longest literal prefix", () => {
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          paths: { "@/*": ["wrong/*"], "@/lib/*": ["right/*"] },
        },
      }),
      "app.ts": 'import { db } from "@/lib/db";\n',
      "wrong/lib/db.ts": "export const db = 1;\n",
      "right/db.ts": "export const db = 2;\n",
    };

    expect(targetOf(files, "app.ts")).toBe("right/db.ts");
  });

  it("tries each target of a pattern until one is in the tree", () => {
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["first/*", "second/*"] } },
      }),
      "app.ts": 'import { db } from "@/db";\n',
      "second/db.ts": "export const db = 1;\n",
    };

    expect(targetOf(files, "app.ts")).toBe("second/db.ts");
  });

  it("leaves an alias pointing outside the tree unresolved but internal", () => {
    expect(
      typescriptResolution({
        ...web,
        "apps/web/app/page.tsx": 'import { db } from "@/lib/missing";\n',
      }),
    ).toEqual({ internal: 1, resolved: 0, rate: 0 });
  });
});

describe("workspace packages", () => {
  const packages = {
    "pnpm-workspace.yaml": PNPM_WORKSPACE,
    "packages/core/package.json": JSON.stringify({
      name: "@acme/core",
      exports: { ".": "./src/index.ts", "./util": "./src/util.ts" },
    }),
    "packages/core/src/index.ts": "export const core = 1;\n",
    "packages/core/src/util.ts": "export const util = 1;\n",
    "packages/app/package.json": JSON.stringify({ name: "@acme/app" }),
    "packages/app/src/main.ts": 'import { core } from "@acme/core";\n',
  };

  it("resolves a package name through the root of its exports map", () => {
    expect(targetOf(packages, "packages/app/src/main.ts")).toBe(
      "packages/core/src/index.ts",
    );
  });

  it("resolves a package subpath through the exports map", () => {
    expect(
      targetOf(
        { ...packages, "packages/app/src/main.ts": 'import "@acme/core/util";\n' },
        "packages/app/src/main.ts",
      ),
    ).toBe("packages/core/src/util.ts");
  });

  it("refuses a subpath the exports map does not publish", () => {
    expect(
      targetOf(
        {
          ...packages,
          "packages/core/src/secret.ts": "export const secret = 1;\n",
          "packages/app/src/main.ts": 'import "@acme/core/src/secret";\n',
        },
        "packages/app/src/main.ts",
      ),
    ).toBeUndefined();
  });

  it("resolves a wildcard exports map", () => {
    expect(
      targetOf(
        {
          ...packages,
          "packages/core/package.json": JSON.stringify({
            name: "@acme/core",
            exports: { "./*": "./src/*.ts" },
          }),
          "packages/app/src/main.ts": 'import "@acme/core/util";\n',
        },
        "packages/app/src/main.ts",
      ),
    ).toBe("packages/core/src/util.ts");
  });

  it("falls back to the package directory when there is no exports map", () => {
    expect(
      targetOf(
        {
          ...packages,
          "packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
          "packages/core/index.ts": "export const core = 1;\n",
        },
        "packages/app/src/main.ts",
      ),
    ).toBe("packages/core/index.ts");
  });

  it("finds packages declared by npm workspaces instead of pnpm", () => {
    const files = {
      "package.json": JSON.stringify({
        name: "root",
        workspaces: ["packages/*"],
      }),
      ...packages,
    };
    delete (files as Record<string, string>)["pnpm-workspace.yaml"];

    expect(index(files).packages).toEqual([
      { name: "@acme/app", root: "packages/app" },
      { name: "@acme/core", root: "packages/core" },
    ]);
  });

  it("reads the object form of npm workspaces", () => {
    const built = index({
      "package.json": JSON.stringify({
        name: "root",
        workspaces: { packages: ["packages/*"] },
      }),
      "packages/core/package.json": JSON.stringify({ name: "@acme/core" }),
    });

    expect(built.packages).toEqual([
      { name: "@acme/core", root: "packages/core" },
    ]);
  });

  it("names the package each indexed file belongs to", () => {
    const built = index(packages);

    expect(built.files.get("packages/app/src/main.ts")?.package).toBe(
      "@acme/app",
    );
    expect(built.files.get("packages/core/src/util.ts")?.package).toBe(
      "@acme/core",
    );
  });

  it("lists no packages in a repository with no workspace config", () => {
    expect(
      index({
        "package.json": JSON.stringify({ name: "solo" }),
        "src/main.ts": "export const main = 1;\n",
      }).packages,
    ).toEqual([]);
  });
});

describe("resolution order", () => {
  const files = {
    "pnpm-workspace.yaml": PNPM_WORKSPACE,
    "packages/app/package.json": JSON.stringify({
      name: "@acme/app",
      imports: { "#src/*": "./src/*.ts" },
    }),
    "packages/app/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "#src/*": ["../aliased/*"] } },
    }),
    "packages/app/src/main.ts": 'import "#src/thing";\n',
    "packages/app/src/thing.ts": "export const thing = 1;\n",
    "packages/aliased/thing.ts": "export const thing = 2;\n",
  };

  it("prefers the import map to a tsconfig path of the same shape", () => {
    expect(targetOf(files, "packages/app/src/main.ts")).toBe(
      "packages/app/src/thing.ts",
    );
  });

  it("prefers a relative path to everything else", () => {
    expect(
      targetOf(
        {
          ...files,
          "packages/app/tsconfig.json": JSON.stringify({
            compilerOptions: { paths: { "./thing": ["../aliased/thing"] } },
          }),
          "packages/app/src/main.ts": 'import "./thing";\n',
        },
        "packages/app/src/main.ts",
      ),
    ).toBe("packages/app/src/thing.ts");
  });

  it("prefers a tsconfig path to a package of the same name", () => {
    expect(
      targetOf(
        {
          ...files,
          "packages/app/tsconfig.json": JSON.stringify({
            compilerOptions: { paths: { "@acme/core": ["../aliased/thing"] } },
          }),
          "packages/core/package.json": JSON.stringify({
            name: "@acme/core",
            exports: { ".": "./index.ts" },
          }),
          "packages/core/index.ts": "export const core = 2;\n",
          "packages/app/src/main.ts": 'import "@acme/core";\n',
        },
        "packages/app/src/main.ts",
      ),
    ).toBe("packages/aliased/thing.ts");
  });
});

describe("third-party specifiers", () => {
  const files = {
    "package.json": JSON.stringify({ name: "solo" }),
    "src/main.ts": [
      'import { readFile } from "node:fs/promises";',
      'import react from "react";',
      'import { z } from "zod/v4";',
      'import { local } from "./local";',
    ].join("\n"),
    "src/local.ts": "export const local = 1;\n",
  };

  it("keeps a bare specifier matching no package out of the rate", () => {
    expect(typescriptResolution(files)).toEqual({
      internal: 1,
      resolved: 1,
      rate: 1,
    });
  });

  it("still records a third-party import as an edge with no target", () => {
    const edges = edgesOf(files, "src/main.ts");

    expect(edges).toHaveLength(4);
    expect(edges.filter((edge) => edge.to === undefined)).toHaveLength(3);
  });

  it("reports a rate of 1 for a language that imports nothing internal", () => {
    expect(
      typescriptResolution({
        "src/main.ts": 'import react from "react";\n',
      }),
    ).toEqual({ internal: 0, resolved: 0, rate: 1 });
  });

  it("reports no resolution for a language it does not parse", () => {
    const built = index({ "app/main.py": "import os\n" });

    expect(built.coverage).toEqual([
      { language: "python", files: 1, indexed: false },
    ]);
  });
});

describe("malformed manifests", () => {
  it("indexes the rest of the tree when a package.json is unparseable", () => {
    const built = index({
      "pnpm-workspace.yaml": PNPM_WORKSPACE,
      "packages/app/package.json": "{ not json",
      "packages/app/src/main.ts": 'import "./other";\n',
      "packages/app/src/other.ts": "export const other = 1;\n",
    });

    expect(built.edges[0]?.to).toBe("packages/app/src/other.ts");
    expect(built.packages).toEqual([]);
  });

  it("drops only the aliases of an unparseable tsconfig", () => {
    const built = index({
      "tsconfig.json": "{ compilerOptions: ",
      "src/main.ts": 'import "@/thing";\nimport "./other";\n',
      "src/other.ts": "export const other = 1;\n",
      "thing.ts": "export const thing = 1;\n",
    });

    expect(built.edges.find((edge) => edge.specifier === "./other")?.to).toBe(
      "src/other.ts",
    );
    expect(built.edges.find((edge) => edge.specifier === "@/thing")?.to).toBeUndefined();
  });

  it("reads a tsconfig written with comments and trailing commas", () => {
    const built = index({
      "tsconfig.json": [
        "{",
        "  // the web app's aliases",
        '  "compilerOptions": { "paths": { "@/*": ["src/*"], }, },',
        "}",
      ].join("\n"),
      "src/main.ts": 'import "@/thing";\n',
      "src/thing.ts": "export const thing = 1;\n",
    });

    expect(built.edges[0]?.to).toBe("src/thing.ts");
  });

  it("ignores a pnpm-workspace.yaml it cannot read a package list from", () => {
    expect(
      index({
        "pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - esbuild\n",
        "packages/app/package.json": JSON.stringify({ name: "@acme/app" }),
      }).packages,
    ).toEqual([]);
  });
});

describe("parseWorkspaceYamlPackages", () => {
  it("reads a block list", () => {
    expect(
      parseWorkspaceYamlPackages("packages:\n  - apps/*\n  - packages/*\n  - evals\n"),
    ).toEqual(["apps/*", "packages/*", "evals"]);
  });

  it("reads a flow list", () => {
    expect(parseWorkspaceYamlPackages('packages: ["apps/*", packages/*]')).toEqual([
      "apps/*",
      "packages/*",
    ]);
  });

  it("stops at the next top-level key", () => {
    expect(
      parseWorkspaceYamlPackages(
        "packages:\n  - apps/*\nonlyBuiltDependencies:\n  - esbuild\n",
      ),
    ).toEqual(["apps/*"]);
  });

  it("ignores comments and quotes", () => {
    expect(
      parseWorkspaceYamlPackages(
        "# the workspace\npackages:\n  # the apps\n  - 'apps/*' # and only these\n",
      ),
    ).toEqual(["apps/*"]);
  });

  it("honours an exclusion pattern", () => {
    expect(
      buildRepositoryIndex({
        sha,
        files: new Map([
          ["pnpm-workspace.yaml", "packages:\n  - packages/*\n  - '!packages/old'\n"],
          ["packages/new/package.json", JSON.stringify({ name: "@acme/new" })],
          ["packages/old/package.json", JSON.stringify({ name: "@acme/old" })],
        ]),
      }).packages,
    ).toEqual([{ name: "@acme/new", root: "packages/new" }]);
  });
});
