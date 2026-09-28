import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import {
  envReadsOn,
  findConfigDrift,
  isEnvExamplePath,
  readDependencies,
  readEnvExample,
} from "#src/config-drift";
import type { PatchedFile } from "#src/patch-lines";

const MANIFEST = [
  "{",
  '  "name": "worker",',
  '  "scripts": {',
  '    "test": "vitest"',
  "  },",
  '  "dependencies": {',
  '    "date-fns": "^4.1.0",',
  '    "zod": "^3.23.0"',
  "  },",
  '  "devDependencies": {',
  '    "vitest": "^2.1.0"',
  "  }",
  "}",
  "",
].join("\n");

const base = new Map([
  ["package.json", MANIFEST],
  [".env.example", "NOTIFY_QUEUE_URL=https://queue.internal\n# NOTIFY_MAX_RETRIES=5\n"],
  ["README.md", "| `NOTIFY_QUEUE_URL` | Queue URL |\n"],
  ["src/expiry.ts", 'import { addMinutes } from "date-fns";\n'],
  ["src/digest.ts", "// digest\nimport { format } from 'date-fns/format';\n"],
  ["src/config.ts", "export const url = process.env.NOTIFY_QUEUE_URL;\n"],
  ["node_modules/x/package.json", '{\n  "dependencies": {\n    "left-pad": "1"\n  }\n}\n'],
]);
const index = buildRepositoryIndex({ sha: "0".repeat(40), files: base });

function added(filename: string, lines: readonly string[], status = "modified"): PatchedFile {
  return {
    filename,
    status,
    patch: [`@@ -1,0 +10,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n"),
  };
}

function drift(files: readonly PatchedFile[]) {
  return findConfigDrift(index, files, new Set(files.map((file) => file.filename)));
}

describe("the index's config", () => {
  it("records env example variables, commented ones included", () => {
    expect(index.envExamples).toEqual([
      { file: ".env.example", line: 1, name: "NOTIFY_QUEUE_URL" },
      { file: ".env.example", line: 2, name: "NOTIFY_MAX_RETRIES" },
    ]);
  });

  it("records dependency entries by line, and none from a vendored manifest", () => {
    expect(index.dependencies).toEqual([
      { manifest: "package.json", line: 7, name: "date-fns" },
      { manifest: "package.json", line: 8, name: "zod" },
      { manifest: "package.json", line: 11, name: "vitest" },
    ]);
    expect(readDependencies("package.json", '{ "dependencies": { "a": "1" } }')).toEqual([]);
  });

  it.each([
    [".env.example", true],
    ["apps/web/.env.local.example", true],
    ["config/sample.env", true],
    [".env", false],
    [".env.local", false],
  ])("isEnvExamplePath(%s) is %s", (path, expected) => {
    expect(isEnvExamplePath(path)).toBe(expected);
  });

  it("reads assignments with an export prefix", () => {
    expect(readEnvExample("x.env.example", "export API_KEY=\nnot an assignment\n")).toEqual([
      { file: "x.env.example", line: 1, name: "API_KEY" },
    ]);
  });
});

describe("envReadsOn", () => {
  it.each([
    ["const a = process.env.SIGNING_SECRET;", ["SIGNING_SECRET"]],
    ["const a = process.env['SIGNING_SECRET'] ?? env.OTHER_KEY;", ["SIGNING_SECRET", "OTHER_KEY"]],
    ["const a = import.meta.env.VITE_API_URL;", ["VITE_API_URL"]],
    ['secret = os.getenv("SIGNING_SECRET")', ["SIGNING_SECRET"]],
    ['token := os.Getenv("SIGNING_SECRET")', ["SIGNING_SECRET"]],
    ['key = ENV.fetch("SIGNING_SECRET")', ["SIGNING_SECRET"]],
    ["if (process.env.NODE_ENV === 'test') {}", []],
    ["const x = config.env.NOT_READ;", []],
  ])("%s", (line, names) => {
    expect(envReadsOn(line)).toEqual(names);
  });
});

describe("findConfigDrift, env vars", () => {
  const read = added("src/signing.ts", ["export const secret = process.env.NOTIFY_SIGNING_SECRET;"], "added");

  it("flags a new env var no example or doc names, citing where the others are documented", () => {
    expect(drift([read]).env).toEqual([
      {
        name: "NOTIFY_SIGNING_SECRET",
        at: { file: "src/signing.ts", line: 10 },
        documented: [
          { file: ".env.example", line: 1 },
          { file: ".env.example", line: 2 },
          { file: "README.md", line: 1 },
        ],
      },
    ]);
  });

  it("says nothing once the pull request documents it, in the example or a doc", () => {
    expect(drift([read, added(".env.example", ["NOTIFY_SIGNING_SECRET="])]).env).toEqual([]);
    expect(drift([read, added("docs/ops.md", ["Set `NOTIFY_SIGNING_SECRET` first."], "added")]).env).toEqual([]);
  });

  it("says nothing about a variable already documented, or one the change only moves", () => {
    expect(drift([added("src/queue.ts", ["const u = process.env.NOTIFY_QUEUE_URL;"])]).env).toEqual([]);
    const moved: PatchedFile = {
      filename: "src/signing.ts",
      status: "modified",
      patch: "@@ -1 +1 @@\n-const s = process.env.LEGACY_SECRET;\n+export const s = process.env.LEGACY_SECRET;",
    };
    expect(drift([moved]).env).toEqual([]);
  });

  it("says nothing in a test, or in a repository that documents no env vars", () => {
    expect(drift([added("src/signing.test.ts", ["process.env.TEST_ONLY_KEY = 'x';"])]).env).toEqual([]);
    const bare = buildRepositoryIndex({ sha: "0".repeat(40), files: new Map([["src/a.ts", ""]]) });
    expect(findConfigDrift(bare, [read], new Set()).env).toEqual([]);
  });
});

describe("findConfigDrift, dependencies", () => {
  const dayjs = added("package.json", ['    "dayjs": "^1.11.13",']);

  it("flags a dependency doing a job one already in use does, citing where that one is used", () => {
    expect(drift([dayjs]).dependencies).toEqual([
      {
        name: "dayjs",
        purpose: "dates",
        at: { file: "package.json", line: 10 },
        existing: "date-fns",
        uses: [
          { file: "src/digest.ts", line: 2 },
          { file: "src/expiry.ts", line: 1 },
        ],
      },
    ]);
  });

  it("still flags one added beside an entry whose trailing comma changed", () => {
    const beside: PatchedFile = {
      filename: "package.json",
      status: "modified",
      patch: '@@ -7 +7,2 @@\n-    "date-fns": "^4.1.0"\n+    "date-fns": "^4.1.0",\n+    "dayjs": "^1.11.13"',
    };
    expect(drift([beside]).dependencies).toMatchObject([{ name: "dayjs", existing: "date-fns" }]);
  });

  it("says nothing about a replacement, an unknown package, a script or an unused alternative", () => {
    const replacing: PatchedFile = {
      filename: "package.json",
      status: "modified",
      patch: '@@ -7 +7 @@\n-    "date-fns": "^4.1.0",\n+    "dayjs": "^1.11.13",',
    };
    expect(drift([replacing]).dependencies).toEqual([]);
    expect(drift([added("package.json", ['    "left-pad": "^1.3.0",'])]).dependencies).toEqual([]);
    expect(drift([added("package.json", ['    "dayjs": "node scripts/dates.js",'])]).dependencies).toEqual([]);
    expect(drift([added("package.json", ['    "axios": "^1.7.0",'])]).dependencies).toEqual([]);
  });
});
