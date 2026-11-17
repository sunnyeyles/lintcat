import { describe, expect, it } from "vitest";

import { addedLines, analyse, beforeDeploying, DEFAULT_DEPLOY_CONFIG, globToRegExp, renderDeployImpact, type AnalyseInput, type DeployImpactConfig } from "#src/engine/deploy-impact";

type Files = Record<string, string>;

// Lines absent from the base file count as added; good enough for single-file fixtures.
function naiveDiff(base: Files, head: Files): string {
  const paths = [...new Set([...Object.keys(base), ...Object.keys(head)])].filter((p) => base[p] !== head[p]).sort();
  return paths
    .map((p) => {
      const before = base[p]?.split("\n") ?? [];
      const after = head[p]?.split("\n") ?? [];
      const kept = new Set(before);
      const body = [...before.filter((l) => !after.includes(l)).map((l) => `-${l}`), ...after.map((l) => (kept.has(l) ? ` ${l}` : `+${l}`))];
      return [`diff --git a/${p} b/${p}`, `--- ${p in base ? `a/${p}` : "/dev/null"}`, `+++ ${p in head ? `b/${p}` : "/dev/null"}`, `@@ -1,${before.length} +1,${after.length} @@`, ...body].join("\n");
    })
    .join("\n");
}

function input(base: Files, head: Files, config: Partial<DeployImpactConfig> = {}): AnalyseInput {
  const files = [...new Set([...Object.keys(base), ...Object.keys(head)])].filter((p) => base[p] !== head[p]).sort();
  const status = new Map(files.map((f) => [f, !(f in base) ? "A" : !(f in head) ? "D" : "M"] as const));
  return {
    diff: naiveDiff(base, head),
    files,
    baseStatus: status,
    readBase: async (p) => base[p] ?? null,
    readHead: async (p) => head[p] ?? null,
    listHead: async () => Object.keys(head),
    baseHasToken: async (token) => Object.values(base).some((text) => new RegExp(`(?<![\\w])${token.replace(/\./g, "\\.")}(?![\\w])`).test(text)),
    config: { ...DEFAULT_DEPLOY_CONFIG, ...config },
  };
}

async function findings(base: Files, head: Files, config?: Partial<DeployImpactConfig>) {
  const i = input(base, head, config);
  const impact = await analyse(i);
  for (const f of impact.findings) expect(i.files).toContain(f.file);
  return impact.findings.map(({ rule, severity, file, line, subject }) => ({ rule, severity, file, line, subject }));
}

const src = "export const a = 1;\n";

describe("env", () => {
  it("flags a new undeclared name as fix and prerequisite on its line (AC2)", async () => {
    const result = await findings({ "src/a.ts": src, ".env.example": "# OTHER=\n" }, { "src/a.ts": `${src}const x = process.env.NEW_THING;\n`, ".env.example": "# OTHER=\n" });
    expect(result).toEqual([
      { rule: "env.new", severity: "prerequisite", file: "src/a.ts", line: 2, subject: "NEW_THING" },
      { rule: "env.undeclared", severity: "fix", file: "src/a.ts", line: 2, subject: "NEW_THING" },
    ]);
  });

  it("ignores a name already used at the base commit (AC2)", async () => {
    const base = { "src/a.ts": "const o = process.env.OLD_THING;\n" };
    expect(await findings(base, { "src/a.ts": `${base["src/a.ts"]}const p = process.env["OLD_THING"];\n` })).toEqual([]);
  });

  it("counts a commented example line as declared (AC3)", async () => {
    const result = await findings(
      { "src/a.ts": src, ".env.example": "# OTHER=\n" },
      { "src/a.ts": `${src}process.env.NEW_THING;\n`, ".env.example": "# OTHER=\n# NEW_THING=\n" },
    );
    expect(result.map((f) => f.rule)).toEqual(["env.new"]);
  });

  it("finds declarations in nested example files", async () => {
    const result = await findings({ "apps/x/main.py": "" }, { "apps/x/main.py": 'os.getenv("API_URL")\n', "apps/x/.env.sample": "API_URL=http://x\n" });
    expect(result.map((f) => f.rule)).toEqual(["env.new"]);
  });

  it.each([
    ['process.env["BRACKET_NAME"]', "BRACKET_NAME"],
    ["import.meta.env.VITE_KEY", "VITE_KEY"],
    ['os.environ["PY_KEY"]', "PY_KEY"],
    ['os.environ.get("PY_GET")', "PY_GET"],
    ['os.Getenv("GO_KEY")', "GO_KEY"],
    ['std::env::var("RUST_KEY")', "RUST_KEY"],
  ])("reads %s", async (code, name) => {
    expect((await findings({ "a.txt": "" }, { "a.txt": `${code}\n` })).map((f) => f.subject)).toEqual([name, name]);
  });

  it("skips always-set, ignored and non-constant names", async () => {
    const code = "process.env.NODE_ENV; process.env.CI; process.env.PORT; process.env.camelCase; process.env.SKIP_ME;\n";
    expect(await findings({ "a.ts": "" }, { "a.ts": code }, { ignoreEnv: ["SKIP_ME"] })).toEqual([]);
  });
});

describe("migrations", () => {
  const dir = "packages/db/drizzle";

  it("flags a dropped column but not an additive column (AC4)", async () => {
    const sql = 'ALTER TABLE "x" ADD COLUMN "z" text;--> statement-breakpoint\nALTER TABLE "x" DROP COLUMN "y";\n';
    expect(await findings({}, { [`${dir}/0002_x.sql`]: sql })).toEqual([
      { rule: "migration.breaking", severity: "prerequisite", file: `${dir}/0002_x.sql`, line: 2, subject: 'ALTER TABLE "x" DROP COLUMN "y"' },
    ]);
    expect(await findings({}, { [`${dir}/0003_y.sql`]: 'ALTER TABLE "x" ADD COLUMN "z" text;\n' })).toEqual([]);
  });

  it("flags editing an existing migration (AC4)", async () => {
    const result = await findings({ [`${dir}/0001_a.sql`]: "CREATE TABLE a (id int);\n" }, { [`${dir}/0001_a.sql`]: "CREATE TABLE a (id bigint);\n" });
    expect(result).toEqual([{ rule: "migration.edited", severity: "fix", file: `${dir}/0001_a.sql`, line: undefined, subject: `${dir}/0001_a.sql` }]);
  });

  it.each([
    ["DROP TABLE old;", "migration.breaking"],
    ["ALTER TABLE a RENAME COLUMN b TO c;", "migration.breaking"],
    ["ALTER TABLE a ALTER COLUMN b SET DATA TYPE bigint;", "migration.breaking"],
    ["ALTER TABLE a ALTER COLUMN b SET NOT NULL;", "migration.breaking"],
    ["ALTER TABLE a ADD COLUMN b text NOT NULL;", "migration.breaking"],
    ["ALTER TABLE a ADD COLUMN b text DEFAULT 'x' NOT NULL;", null],
    ["CREATE INDEX i ON a (b);", "migration.locking"],
    ["CREATE INDEX CONCURRENTLY i ON a (b);", null],
    ["ALTER TABLE a ADD CONSTRAINT c FOREIGN KEY (b) REFERENCES t(id);", "migration.locking"],
    ["ALTER TABLE a ADD CONSTRAINT c FOREIGN KEY (b) REFERENCES t(id) NOT VALID;", null],
    ["-- DROP TABLE old;\n/* DROP COLUMN x; */\nCREATE TABLE n (id int);", null],
  ])("%s → %s", async (sql, rule) => {
    const result = await findings({}, { "db/migrations/0001/up.sql": `${sql}\n` });
    expect(result.map((f) => f.rule)).toEqual(rule ? [rule] : []);
  });

  it("matches prisma migrations and ignores other sql", async () => {
    expect((await findings({}, { "prisma/migrations/20260101_x/migration.sql": "DROP TABLE a;\n" })).map((f) => f.rule)).toEqual(["migration.breaking"]);
    expect(await findings({}, { "scripts/seed.sql": "DROP TABLE a;\n" })).toEqual([]);
  });
});

describe("workflows", () => {
  const wf = ".github/workflows/ci.yml";
  const base = ["on: push", "permissions:", "  contents: read", "jobs:", "  test:", "    runs-on: ubuntu-latest", "    steps:", "      - run: echo ${{ secrets.OLD_SECRET }}", ""].join("\n");

  it("flags a scope gaining write (AC5)", async () => {
    expect(await findings({ [wf]: base }, { [wf]: base.replace("contents: read", "contents: write") })).toEqual([
      { rule: "workflow.permissions", severity: "prerequisite", file: wf, line: 3, subject: "contents: write" },
    ]);
  });

  it("flags a removed permissions block (AC5)", async () => {
    expect((await findings({ [wf]: base }, { [wf]: base.replace("permissions:\n  contents: read\n", "") })).map((f) => f.rule)).toEqual(["workflow.permissions"]);
  });

  it("flags unpinned actions, new secrets and risky triggers (AC5)", async () => {
    const head = base
      .replace("on: push", "on: [push, pull_request_target]")
      .concat(
        [
          "      - uses: foo/bar@v1",
          "      - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567",
          "      - uses: ./local-action",
          "      - run: echo ${{ secrets.NEW_SECRET }} ${{ secrets.OLD_SECRET }} ${{ secrets.GITHUB_TOKEN }}",
          "",
        ].join("\n"),
      );
    expect((await findings({ [wf]: base }, { [wf]: head })).map((f) => [f.rule, f.subject])).toEqual([
      ["workflow.trigger", "pull_request_target"],
      ["workflow.secret", "NEW_SECRET"],
      ["workflow.unpinned", "foo/bar@v1"],
    ]);
  });

  it("flags write-all on a new workflow", async () => {
    const result = await findings({}, { ".github/workflows/x.yaml": "on: push\npermissions: write-all\njobs: {}\n" });
    expect(result.map((f) => [f.rule, f.line])).toEqual([["workflow.permissions", 2]]);
  });
});

describe("deploy config and dependencies", () => {
  it("lists deploy config changes, including configured paths", async () => {
    const result = await findings({}, { "apps/worker/Dockerfile": "FROM node\n", "infra/main.tf": "", "deploy/run.sh": "x\n" }, { deployConfig: ["deploy/*.sh"] });
    expect(result.map((f) => [f.rule, f.file])).toEqual([
      ["deploy.config", "apps/worker/Dockerfile"],
      ["deploy.config", "deploy/run.sh"],
      ["deploy.config", "infra/main.tf"],
    ]);
  });

  it("lists new runtime dependencies only", async () => {
    const before = JSON.stringify({ dependencies: { a: "1" } }, null, 2);
    const after = JSON.stringify({ dependencies: { a: "1", b: "^2" }, devDependencies: { c: "3" }, optionalDependencies: { d: "4" } }, null, 2);
    expect((await findings({ "package.json": before }, { "package.json": after })).map((f) => f.subject)).toEqual(["b@^2", "d@4"]);
  });
});

describe("rendering", () => {
  it("orders prerequisites, then fixes, then notes, and only puts the first two in the PR", async () => {
    const impact = await analyse(input({}, { "src/a.ts": "process.env.NEW_THING;\n", Dockerfile: "FROM node\n" }));
    expect(renderDeployImpact(impact).map((l) => l.split(" ")[1])).toEqual(["**env.new**", "**env.undeclared**", "**deploy.config**"]);
    expect(beforeDeploying(impact)).toEqual(["", "## Before deploying", "", expect.stringMatching(/^- \[ \] \*\*env\.new\*\*/), expect.stringMatching(/^- \[ \] \*\*env\.undeclared\*\*/)]);
    expect(renderDeployImpact({ findings: [], changed: { migrations: [], workflows: [], deployConfig: [], manifests: [] } })).toEqual(["No deploy impact detected."]);
    expect(beforeDeploying(undefined)).toEqual([]);
  });
});

describe("helpers", () => {
  it.each([
    ["**/drizzle/*.sql", "packages/db/drizzle/0001.sql", true],
    ["**/drizzle/*.sql", "drizzle/0001.sql", true],
    ["**/drizzle/*.sql", "drizzle/meta/x.sql", false],
    [".github/workflows/*.{yml,yaml}", ".github/workflows/ci.yaml", true],
    ["**/.env.example", ".env.example", true],
    [".env.example", "apps/.env.example", false],
  ])("%s matches %s: %s", (glob, file, expected) => {
    expect(globToRegExp(glob).test(file)).toBe(expected);
  });

  it("reads head-side line numbers and keeps removed `--` lines out of the headers", () => {
    const diff = ["diff --git a/x.sql b/x.sql", "--- a/x.sql", "+++ b/x.sql", "@@ -1,3 +1,3 @@", " keep", "--- removed comment", "+++ added", "+new", " tail"].join("\n");
    expect(addedLines(diff).get("x.sql")).toEqual([
      { line: 2, text: "++ added" },
      { line: 3, text: "new" },
    ]);
  });
});
