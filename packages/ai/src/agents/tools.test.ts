import { buildRepositoryIndex, UNINDEXED_PATH_REASON } from "@pr-review/index";
import type { Tool, ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { INDEX_ABSENT_LINE } from "#src/agents/repository-index";
import { createReviewTools } from "#src/agents/tools";
import {
  REVIEW_TOOL_NAMES,
  archiveFiles,
  baseSha,
  changedFiles,
  context,
  headSha,
  makeGithub,
  pullRequest,
} from "#src/agent-test-support";

/** The index the fake archive builds, as the reviewer would build it. */
function index() {
  return buildRepositoryIndex({ sha: baseSha, files: archiveFiles });
}

/** The shared context plus one changed file that carries no patch. */
const scope = {
  ...context,
  changedFiles: [
    ...changedFiles,
    { filename: "assets/logo.png", status: "added", additions: 0, deletions: 0 },
  ],
};

/** The SDK stores the Zod schema we passed, so tests can parse against it. */
function schemaOf(tools: ToolSet, name: string): z.ZodType {
  return tools[name]?.inputSchema as unknown as z.ZodType;
}

/** The SDK supplies these to `execute`; nothing under test reads them. */
const executeOptions = {
  toolCallId: "call-1",
  messages: [],
} as unknown as Parameters<NonNullable<Tool["execute"]>>[1];

function run(tools: ToolSet, name: string, input: unknown): Promise<unknown> {
  const execute = tools[name]?.execute;
  if (execute === undefined) {
    throw new Error(`no executable tool named ${name}`);
  }
  return Promise.resolve(execute(input, executeOptions));
}

const narrowed = {
  ...context,
  diff: "@@ -2 +2 @@\n+const limit = 0;\n",
  changedFiles: [changedFiles[0]!],
  incremental: {
    sinceSha: "old111",
    diff: context.diff,
    changedFiles: [
      ...changedFiles,
      { filename: "docs/sessions.md", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+docs\n" },
    ],
  },
};

describe("createReviewTools on a narrowed review", () => {
  it("lists every file the pull request changed, not only the narrowed set", async () => {
    const tools = createReviewTools(makeGithub(), narrowed);

    const listed = JSON.parse(
      String(await run(tools, "list_changed_files", {})),
    ) as { filename: string }[];

    expect(listed.map((file) => file.filename)).toContain("docs/sessions.md");
  });

  it("serves the whole pull request's diff, so an agent can widen", async () => {
    const tools = createReviewTools(makeGithub(), narrowed);

    expect(await run(tools, "get_diff", {})).toBe(context.diff);
  });

  it("serves a patch for a file the narrowed diff does not cover", async () => {
    const tools = createReviewTools(makeGithub(), narrowed);

    expect(await run(tools, "get_diff", { path: "docs/sessions.md" })).toContain(
      "+docs",
    );
  });
});

describe("createReviewTools", () => {
  it("exposes exactly the eight read-only tools from the spec", () => {
    expect(Object.keys(createReviewTools(makeGithub(), scope)).sort()).toEqual(
      REVIEW_TOOL_NAMES,
    );
  });

  it("describes every tool it exposes", () => {
    for (const tool of Object.values(createReviewTools(makeGithub(), scope))) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(0);
    }
  });

  /** Descriptions live on the Zod schemas, where a new field is easy to forget. */
  it.each([
    ["get_file", ["path"]],
    ["get_base_file", ["path"]],
    ["search_repository", ["query"]],
    ["get_diff", ["path"]],
    ["find_references", ["path", "name"]],
    ["find_co_changed_files", ["path"]],
  ])("describes every parameter of %s", (name, parameters) => {
    const tools = createReviewTools(makeGithub(), scope);
    const shape = (
      schemaOf(tools, name) as unknown as {
        shape: Record<string, { description?: string }>;
      }
    ).shape;
    expect(Object.keys(shape)).toEqual(parameters);
    for (const parameter of parameters) {
      expect(shape[parameter]?.description).toBeTruthy();
    }
  });

  it("offers no tool that could write to the repository", () => {
    const tools = createReviewTools(makeGithub(), scope);
    expect(tools["approve_pull_request"]).toBeUndefined();
    expect(tools["create_review"]).toBeUndefined();
  });
});

describe("review tool execution", () => {
  it("answers get_pull_request from the review context, not GitHub", async () => {
    const github = makeGithub();
    const result = await run(
      createReviewTools(github, scope),
      "get_pull_request",
      {},
    );

    expect(github.getPullRequest).not.toHaveBeenCalled();
    expect(JSON.parse(result as string)).toEqual(pullRequest);
  });

  it("lists changed files from the review context, without their patches", async () => {
    const github = makeGithub();
    const result = await run(
      createReviewTools(github, scope),
      "list_changed_files",
      {},
    );

    expect(github.listChangedFiles).not.toHaveBeenCalled();
    expect(JSON.parse(result as string)).toEqual([
      {
        filename: "src/sessions.ts",
        status: "modified",
        additions: 3,
        deletions: 0,
      },
      {
        filename: "assets/logo.png",
        status: "added",
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  it("returns the loaded diff verbatim when get_diff names no path", async () => {
    const github = makeGithub();
    const result = await run(createReviewTools(github, scope), "get_diff", {});

    expect(github.getDiff).not.toHaveBeenCalled();
    expect(result).toBe(context.diff);
  });

  it("returns one file's patch when get_diff names a path", async () => {
    const result = await run(createReviewTools(makeGithub(), scope), "get_diff", {
      path: "src/sessions.ts",
    });

    expect(result).toBe(context.changedFiles[0]?.patch);
  });

  it("rejects get_diff for a path the pull request did not change", async () => {
    await expect(
      run(createReviewTools(makeGithub(), scope), "get_diff", {
        path: "src/elsewhere.ts",
      }),
    ).rejects.toThrow("not a file this pull request changed");
  });

  it("rejects get_diff for a changed file that carries no patch", async () => {
    await expect(
      run(createReviewTools(makeGithub(), scope), "get_diff", {
        path: "assets/logo.png",
      }),
    ).rejects.toThrow("no patch");
  });

  it("reads get_file at the head commit", async () => {
    const github = makeGithub();
    await run(createReviewTools(github, scope), "get_file", {
      path: "src/sessions.ts",
    });

    expect(github.getFileContents).toHaveBeenCalledWith({
      owner: scope.owner,
      repo: scope.repo,
      path: "src/sessions.ts",
      ref: headSha,
    });
  });

  it("reads get_base_file at the base commit", async () => {
    const github = makeGithub();
    await run(createReviewTools(github, scope), "get_base_file", {
      path: "src/sessions.ts",
    });

    expect(github.getFileContents).toHaveBeenCalledWith({
      owner: scope.owner,
      repo: scope.repo,
      path: "src/sessions.ts",
      ref: baseSha,
    });
  });

  it("scopes search_repository to the pull request's own repository", async () => {
    const github = makeGithub();
    const result = await run(
      createReviewTools(github, scope),
      "search_repository",
      { query: "createSession" },
    );

    expect(github.searchCode).toHaveBeenCalledWith({
      owner: scope.owner,
      repo: scope.repo,
      query: "createSession",
    });
    expect(JSON.parse(result as string)).toEqual({
      totalCount: 1,
      incompleteResults: false,
      matches: [
        {
          path: "src/sessions.ts",
          name: "sessions.ts",
          snippets: ["export function createSession() {"],
        },
      ],
    });
  });

  it("trims and deduplicates snippets before capping them", async () => {
    const github = makeGithub();
    github.searchCode.mockResolvedValueOnce({
      matches: [
        {
          path: "src/a.ts",
          name: "a.ts",
          snippets: ["same\n", "  same", "", "different", "third"],
        },
      ],
      totalCount: 1,
      incompleteResults: false,
    });

    const result = (await run(createReviewTools(github, scope), "search_repository", {
      query: "createSession",
    })) as string;

    // Deduplication precedes the cap, or duplicates would consume the budget.
    expect(JSON.parse(result).matches[0].snippets).toEqual(["same", "different"]);
  });

  it("caps snippets so an oversized search result is still valid JSON", async () => {
    const github = makeGithub();
    github.searchCode.mockResolvedValueOnce({
      matches: Array.from({ length: 30 }, (_unused, index) => ({
        path: `src/file-${index}.ts`,
        name: `file-${index}.ts`,
        // Distinct, so the cap rather than deduplication is what bounds them.
        snippets: Array.from({ length: 5 }, (_u, n) => `${n}${"x".repeat(5_000)}`),
      })),
      totalCount: 843,
      incompleteResults: true,
    });

    const result = (await run(createReviewTools(github, scope), "search_repository", {
      query: "createSession",
    })) as string;

    // The caps are the only thing keeping this under the tool result limit,
    // which no truncation may enforce here: it would cut the JSON mid-string.
    expect(result.length).toBeLessThan(50_000);
    expect(result).not.toMatch(/truncated/i);
    const payload = JSON.parse(result);
    expect(payload.totalCount).toBe(843);
    expect(payload.incompleteResults).toBe(true);
    expect(payload.matches).toHaveLength(20);
    for (const match of payload.matches) {
      expect(match.snippets).toHaveLength(2);
      expect(match.snippets[0].length).toBeLessThanOrEqual(401);
    }
  });

  it("lists every file importing a path, with the line each import sits on", async () => {
    const result = (await run(
      createReviewTools(makeGithub(), scope, index()),
      "find_references",
      { path: "src/sessions.ts" },
    )) as string;

    expect(JSON.parse(result)).toMatchObject({
      path: "src/sessions.ts",
      known: true,
      total: 4,
      references: [
        { path: "src/admin.ts", imports: [{ line: 1, kind: "namespace", name: "*" }] },
        { path: "src/api.ts", imports: [{ line: 1, kind: "named", name: "createSession" }] },
        { path: "src/boot.ts", imports: [{ line: 1, kind: "side-effect" }] },
        { path: "src/sessions.test.ts", imports: [{ line: 1, kind: "named", name: "sessions" }] },
      ],
    });
  });

  it("narrows to one name, keeping the namespace importer that can see it", async () => {
    const result = (await run(
      createReviewTools(makeGithub(), scope, index()),
      "find_references",
      { path: "src/sessions.ts", name: "createSession" },
    )) as string;

    const payload = JSON.parse(result);
    expect(payload.name).toBe("createSession");
    expect(payload.total).toBe(2);
    expect(payload.references.map((reference: { path: string }) => reference.path)).toEqual([
      "src/admin.ts",
      "src/api.ts",
    ]);
  });

  it("carries the index header on every result", async () => {
    const result = (await run(
      createReviewTools(makeGithub(), scope, index()),
      "find_references",
      { path: "src/sessions.ts" },
    )) as string;

    expect(JSON.parse(result).index).toEqual({
      sha: baseSha,
      files: 7,
      truncated: false,
      languages: expect.arrayContaining([
        {
          language: "typescript",
          files: 6,
          indexed: true,
          resolution: { internal: 5, resolved: 5, rate: 1 },
        },
        { language: "markdown", files: 1, indexed: false },
      ]),
    });
  });

  it("shows a rate below one when an alias points outside the tree", async () => {
    const aliased = new Map<string, string>([
      [
        "tsconfig.json",
        JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } }),
      ],
      ["src/sessions.ts", "export const sessions = [];\n"],
      ["src/api.ts", 'import { sessions } from "@/sessions";\n'],
      ["src/boot.ts", 'import { gone } from "@/gone";\n'],
    ]);
    const result = (await run(
      createReviewTools(
        makeGithub(),
        scope,
        buildRepositoryIndex({ sha: baseSha, files: aliased }),
      ),
      "find_references",
      { path: "src/sessions.ts" },
    )) as string;

    const payload = JSON.parse(result);
    expect(payload.index.languages[0].resolution).toEqual({
      internal: 2,
      resolved: 1,
      rate: 0.5,
    });
    expect(payload.total).toBe(1);
  });

  it("reports the true total while returning at most fifty files", async () => {
    const wide = new Map<string, string>([["src/wide.ts", "export const wide = 1;\n"]]);
    for (let at = 0; at < 60; at += 1) {
      wide.set(`src/caller-${at}.ts`, `import { wide } from "./wide";\n`);
    }
    const tools = createReviewTools(
      makeGithub(),
      scope,
      buildRepositoryIndex({ sha: baseSha, files: wide }),
    );

    const payload = JSON.parse(
      (await run(tools, "find_references", { path: "src/wide.ts" })) as string,
    );
    expect(payload.total).toBe(60);
    expect(payload.references).toHaveLength(50);
  });

  it("says a path the pull request added has no node at the base commit", async () => {
    const added = {
      ...scope,
      changedFiles: [
        { filename: "src/new.ts", status: "added", additions: 4, deletions: 0 },
      ],
    };

    const payload = JSON.parse(
      (await run(
        createReviewTools(makeGithub(), added, index()),
        "find_references",
        { path: "src/new.ts" },
      )) as string,
    );
    expect(payload.known).toBe(false);
    expect(payload.reason).toMatch(/added by this pull request/);
    expect(payload.index.sha).toBe(baseSha);
  });

  it("says a path it does not hold is unknown, never that it does not exist", async () => {
    const payload = JSON.parse(
      (await run(
        createReviewTools(makeGithub(), scope, index()),
        "find_references",
        { path: "src/elsewhere.ts" },
      )) as string,
    );
    expect(payload.known).toBe(false);
    expect(payload.reason).toBe(UNINDEXED_PATH_REASON);
    expect(JSON.stringify(payload)).not.toMatch(/does not exist/);
  });

  it("returns an empty list for an indexed file nothing imports", async () => {
    const payload = JSON.parse(
      (await run(
        createReviewTools(makeGithub(), scope, index()),
        "find_references",
        { path: "src/boot.ts" },
      )) as string,
    );
    expect(payload).toMatchObject({ known: true, total: 0, references: [] });
  });

  it("says so in one line when the review has no index", async () => {
    const result = await run(
      createReviewTools(makeGithub(), scope),
      "find_references",
      { path: "src/sessions.ts" },
    );

    expect(result).toBe(INDEX_ABSENT_LINE);
    expect(String(result).split("\n")).toHaveLength(1);
  });

  it.each([
    ["path traversal", { path: "../secrets/config.yml" }],
    ["absolute path", { path: "/etc/passwd" }],
    ["extra properties", { path: "src/sessions.ts", ref: "deadbeef" }],
    ["a name that is not one identifier", { path: "src/sessions.ts", name: "a b" }],
  ])("rejects find_references input with %s", (_label, input) => {
    const tools = createReviewTools(makeGithub(), scope, index());
    expect(schemaOf(tools, "find_references").safeParse(input).success).toBe(false);
  });

  it("ranks co-changed files by commit count and excludes the subject file", async () => {
    const github = makeGithub();
    github.listCommitShas.mockResolvedValueOnce(["c1", "c2", "c3"]);
    github.listCommitFiles
      .mockResolvedValueOnce(["src/sessions.ts", "docs/sessions.md"])
      .mockResolvedValueOnce(["src/sessions.ts", "docs/sessions.md", "src/rate.ts"])
      .mockResolvedValueOnce(["src/sessions.ts", "docs/sessions.md"]);

    const result = (await run(
      createReviewTools(github, scope),
      "find_co_changed_files",
      { path: "src/sessions.ts" },
    )) as string;

    expect(github.listCommitShas).toHaveBeenCalledExactlyOnceWith({
      owner: scope.owner,
      repo: scope.repo,
      path: "src/sessions.ts",
      limit: 10,
    });
    expect(github.listCommitFiles).toHaveBeenCalledTimes(3);
    expect(JSON.parse(result)).toEqual({
      path: "src/sessions.ts",
      commitsExamined: 3,
      commitsSkippedAsSweeps: 0,
      coChanged: [
        { path: "docs/sessions.md", commits: 3 },
        { path: "src/rate.ts", commits: 1 },
      ],
    });
  });

  it("skips sweeping commits rather than counting their files", async () => {
    const github = makeGithub();
    const sweep = Array.from({ length: 41 }, (_unused, index) => `src/file-${index}.ts`);
    github.listCommitShas.mockResolvedValueOnce(["c1", "c2"]);
    github.listCommitFiles
      .mockResolvedValueOnce(sweep)
      .mockResolvedValueOnce(["src/sessions.ts", "docs/sessions.md"]);

    const result = (await run(
      createReviewTools(github, scope),
      "find_co_changed_files",
      { path: "src/sessions.ts" },
    )) as string;

    expect(JSON.parse(result)).toEqual({
      path: "src/sessions.ts",
      commitsExamined: 1,
      commitsSkippedAsSweeps: 1,
      coChanged: [{ path: "docs/sessions.md", commits: 1 }],
    });
  });

  it("reads each commit once, however many files share it", async () => {
    const github = makeGithub();
    github.listCommitShas.mockResolvedValue(["c1", "c2"]);
    const tools = createReviewTools(github, scope);

    await run(tools, "find_co_changed_files", { path: "src/sessions.ts" });
    await run(tools, "find_co_changed_files", { path: "docs/sessions.md" });

    expect(github.listCommitFiles).toHaveBeenCalledTimes(2);
  });

  it("reports an empty history without reading any commit", async () => {
    const github = makeGithub();
    github.listCommitShas.mockResolvedValueOnce([]);

    const result = (await run(
      createReviewTools(github, scope),
      "find_co_changed_files",
      { path: "src/added-by-this-pr.ts" },
    )) as string;

    expect(github.listCommitFiles).not.toHaveBeenCalled();
    expect(JSON.parse(result)).toEqual({
      path: "src/added-by-this-pr.ts",
      commitsExamined: 0,
      commitsSkippedAsSweeps: 0,
      coChanged: [],
    });
  });

  it("caps the co-changed files it reports", async () => {
    const github = makeGithub();
    github.listCommitShas.mockResolvedValueOnce(["c1"]);
    github.listCommitFiles.mockResolvedValueOnce(
      Array.from({ length: 40 }, (_unused, index) => `src/file-${index}.ts`),
    );

    const result = (await run(
      createReviewTools(github, scope),
      "find_co_changed_files",
      { path: "src/sessions.ts" },
    )) as string;

    expect(JSON.parse(result).coChanged).toHaveLength(20);
  });

  it.each([
    ["path traversal", { path: "../../secrets/config.yml" }],
    ["absolute path", { path: "/etc/passwd" }],
    ["extra properties", { path: "src/sessions.ts", ref: "deadbeef" }],
  ])("rejects find_co_changed_files input with %s", (_label, input) => {
    const tools = createReviewTools(makeGithub(), scope);
    expect(schemaOf(tools, "find_co_changed_files").safeParse(input).success).toBe(
      false,
    );
  });

  it("truncates oversized tool results", async () => {
    const huge = { ...scope, diff: "x".repeat(200_000) };

    const result = (await run(
      createReviewTools(makeGithub(), huge),
      "get_diff",
      {},
    )) as string;

    expect(result.length).toBeLessThan(200_000);
    expect(result).toMatch(/truncated/i);
  });

  /** The SDK turns a rejected execute into a tool-error the model reads. */
  it("lets a github client failure reject rather than swallowing it", async () => {
    const github = makeGithub();
    github.getFileContents.mockRejectedValueOnce(new Error("404 not found"));

    await expect(
      run(createReviewTools(github, scope), "get_file", {
        path: "src/missing.ts",
      }),
    ).rejects.toThrow("404 not found");
  });
});

/** The SDK validates against these before `execute` ever runs. */
describe("review tool input schemas", () => {
  it.each([
    ["missing path", {}],
    ["non-string path", { path: 42 }],
    ["non-object input", "src/sessions.ts"],
    ["empty path", { path: "" }],
    ["absolute path", { path: "/etc/passwd" }],
    ["path traversal", { path: "../../secrets/config.yml" }],
    ["extra properties", { path: "src/sessions.ts", ref: "some-other-sha" }],
  ])("rejects get_file with %s", (_label, input) => {
    const tools = createReviewTools(makeGithub(), scope);
    expect(schemaOf(tools, "get_file").safeParse(input).success).toBe(false);
  });

  it.each([
    ["a repo: qualifier", { query: "secrets repo:someone-else/private" }],
    ["an org: qualifier", { query: "org:someone-else token" }],
    ["a user: qualifier", { query: "user:someone-else token" }],
    ["an empty query", { query: "" }],
    ["an over-long query", { query: "x".repeat(300) }],
    ["a non-string query", { query: { nested: true } }],
  ])("rejects search_repository with %s", (_label, input) => {
    const tools = createReviewTools(makeGithub(), scope);
    expect(schemaOf(tools, "search_repository").safeParse(input).success).toBe(
      false,
    );
  });

  it("rejects unexpected properties on a no-input tool", () => {
    const tools = createReviewTools(makeGithub(), scope);
    expect(
      schemaOf(tools, "get_diff").safeParse({ pull_number: 7 }).success,
    ).toBe(false);
  });

  it("accepts a plain repository-relative path", () => {
    const tools = createReviewTools(makeGithub(), scope);
    expect(
      schemaOf(tools, "get_file").safeParse({ path: "src/index.ts" }).success,
    ).toBe(true);
  });
});
