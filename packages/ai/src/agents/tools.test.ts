import type {
  AreaDescription,
  IndexStatus,
  ReferencesResult,
  RepositoryIndex,
  SymbolDescription,
} from "@pr-review/index";
import type { Tool, ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { createReviewTools } from "./tools.js";
import {
  REVIEW_TOOL_NAMES,
  baseSha,
  changedFiles,
  context,
  headSha,
  makeGithub,
  pullRequest,
} from "../agent-test-support.js";

/** The shared context plus one changed file that carries no patch. */
const scope = {
  ...context,
  changedFiles: [
    ...changedFiles,
    { filename: "assets/logo.png", status: "added", additions: 0, deletions: 0 },
  ],
};

const builtAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

const status: IndexStatus = {
  sha: "1111111111111111111111111111111111111111",
  builtAt,
  coverage: {
    files: 120,
    truncated: false,
    languages: { typescript: 118, json: 2 },
    manifests: ["pnpm-workspace"],
  },
  languages: [
    { language: "typescript", files: 118, indexed: true, resolutionRate: 0.96 },
    { language: "python", files: 2, indexed: false, resolutionRate: 0 },
  ],
};

const described: AreaDescription = {
  path: "src/sessions.ts",
  known: true,
  package: {
    name: "@octo/example-service",
    root: "",
    entryPoints: ["src/index.ts"],
    dependsOn: [],
  },
  role: "source",
  language: "typescript",
  owners: ["@octo-org/platform"],
  tests: ["src/sessions.test.ts"],
  covers: [],
  siblings: ["src/index.ts"],
  siblingsTotal: 2,
};

const symbol: SymbolDescription = {
  path: "src/sessions.ts",
  name: "createSession",
  known: true,
  symbol: {
    id: 7,
    file: "src/sessions.ts",
    name: "createSession",
    kind: "function",
    line: 40,
    endLine: 52,
    exported: true,
  },
  candidates: [
    {
      id: 91,
      file: "src/legacy/sessions.ts",
      name: "createSession",
      kind: "function",
      line: 12,
      endLine: 18,
      exported: false,
    },
  ],
  inboundReferences: 14,
  referencingFiles: 5,
};

const importers: ReferencesResult = {
  path: "src/sessions.ts",
  name: null,
  known: true,
  importers: ["src/api/routes.ts", "src/sessions.test.ts"],
  totalImporters: 2,
  references: [],
  totalReferences: 0,
  totalFiles: 0,
};

const symbolReferences: ReferencesResult = {
  path: "src/sessions.ts",
  name: "createSession",
  known: true,
  importers: [],
  totalImporters: 0,
  references: [
    { file: "src/api/routes.ts", lines: [11, 88] },
    { file: "src/sessions.test.ts", lines: [4] },
  ],
  totalReferences: 212,
  totalFiles: 50,
};

interface IndexParts {
  description?: AreaDescription;
  symbol?: SymbolDescription;
  references?: ReferencesResult;
}

/** Hand-written, not the real index: only the read seam the tools use. */
function makeIndex(parts: IndexParts = {}): RepositoryIndex {
  return {
    status: async () => status,
    describeArea: async () => parts.description ?? described,
    getSymbol: async () => parts.symbol ?? symbol,
    findReferences: async (_path, name) =>
      parts.references ?? (name === undefined ? importers : symbolReferences),
  };
}

/** What an index tool answers with when no index is bound to the review. */
const ABSENT_PAYLOAD = {
  status: "absent",
  reason: "no repository index for this review",
};

/** The header every index tool repeats, so a result says how current it is. */
const indexHeader = {
  sha: status.sha,
  ageHours: 3,
  coverage: status.coverage,
  languages: status.languages,
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

describe("createReviewTools", () => {
  it("exposes exactly the ten read-only tools from the spec", () => {
    expect(Object.keys(createReviewTools(makeGithub(), scope)).sort()).toEqual(
      REVIEW_TOOL_NAMES,
    );
  });

  it("exposes the same ten tools when an index is bound", () => {
    expect(
      Object.keys(createReviewTools(makeGithub(), scope, makeIndex())).sort(),
    ).toEqual(REVIEW_TOOL_NAMES);
  });

  it("describes every tool it exposes", () => {
    for (const tool of Object.values(createReviewTools(makeGithub(), scope))) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(0);
    }
  });

  /** Descriptions live on the Zod schemas, where a new field is easy to forget. */
  it.each([
    ["get_file", "path"],
    ["get_base_file", "path"],
    ["search_repository", "query"],
    ["get_diff", "path"],
    ["find_co_changed_files", "path"],
    ["describe_area", "path"],
  ])("describes %s's %s parameter", (name, parameter) => {
    const tools = createReviewTools(makeGithub(), scope);
    const shape = (
      schemaOf(tools, name) as unknown as {
        shape: Record<string, { description?: string }>;
      }
    ).shape;
    expect(Object.keys(shape)).toEqual([parameter]);
    expect(shape[parameter]?.description).toBeTruthy();
  });

  it.each([
    ["get_symbol", ["path", "name"]],
    ["find_references", ["path", "name"]],
  ])("describes both of %s's parameters", (name, parameters) => {
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

    expect(result).toBe("@@ -40,2 +40,5 @@");
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

  it("answers describe_area from the index, with the index's own status", async () => {
    const index = makeIndex();
    const describeArea = vi.spyOn(index, "describeArea");

    const result = (await run(
      createReviewTools(makeGithub(), scope, index),
      "describe_area",
      { path: "src/sessions.ts" },
    )) as string;

    expect(describeArea).toHaveBeenCalledExactlyOnceWith("src/sessions.ts");
    expect(JSON.parse(result)).toEqual({ index: indexHeader, ...described });
  });

  it("reports a path the index does not know without claiming it is missing", async () => {
    const unknown: AreaDescription = {
      path: "src/added-by-this-pr.ts",
      known: false,
      package: null,
      role: null,
      language: null,
      owners: [],
      tests: [],
      covers: [],
      siblings: [],
      siblingsTotal: 0,
    };

    const result = (await run(
      createReviewTools(makeGithub(), scope, makeIndex({ description: unknown })),
      "describe_area",
      { path: "src/added-by-this-pr.ts" },
    )) as string;

    expect(JSON.parse(result)).toMatchObject({ known: false });
  });

  it("answers describe_area in absent mode when there is no index", async () => {
    const result = (await run(
      createReviewTools(makeGithub(), scope),
      "describe_area",
      { path: "src/sessions.ts" },
    )) as string;

    expect(JSON.parse(result)).toEqual({ index: ABSENT_PAYLOAD });
  });

  it("answers get_symbol from the index, with the index's own status", async () => {
    const index = makeIndex();
    const getSymbol = vi.spyOn(index, "getSymbol");

    const result = (await run(
      createReviewTools(makeGithub(), scope, index),
      "get_symbol",
      { path: "src/sessions.ts", name: "createSession" },
    )) as string;

    expect(getSymbol).toHaveBeenCalledExactlyOnceWith(
      "src/sessions.ts",
      "createSession",
    );
    expect(JSON.parse(result)).toEqual({ index: indexHeader, ...symbol });
  });

  it("reports a symbol the index does not define without denying it exists", async () => {
    const unknown: SymbolDescription = {
      path: "src/added-by-this-pr.ts",
      name: "createSession",
      known: false,
      symbol: null,
      candidates: [],
      inboundReferences: 0,
      referencingFiles: 0,
    };

    const result = (await run(
      createReviewTools(makeGithub(), scope, makeIndex({ symbol: unknown })),
      "get_symbol",
      { path: "src/added-by-this-pr.ts", name: "createSession" },
    )) as string;

    expect(JSON.parse(result)).toMatchObject({ known: false, symbol: null });
  });

  it("answers get_symbol in absent mode when there is no index", async () => {
    const result = (await run(
      createReviewTools(makeGithub(), scope),
      "get_symbol",
      { path: "src/sessions.ts", name: "createSession" },
    )) as string;

    expect(JSON.parse(result)).toEqual({ index: ABSENT_PAYLOAD });
  });

  it("returns the importing files when find_references names no symbol", async () => {
    const index = makeIndex();
    const findReferences = vi.spyOn(index, "findReferences");

    const result = (await run(
      createReviewTools(makeGithub(), scope, index),
      "find_references",
      { path: "src/sessions.ts" },
    )) as string;

    expect(findReferences).toHaveBeenCalledExactlyOnceWith(
      "src/sessions.ts",
      undefined,
    );
    expect(JSON.parse(result)).toEqual({ index: indexHeader, ...importers });
  });

  it("returns references grouped by file when find_references names a symbol", async () => {
    const index = makeIndex();
    const findReferences = vi.spyOn(index, "findReferences");

    const result = (await run(
      createReviewTools(makeGithub(), scope, index),
      "find_references",
      { path: "src/sessions.ts", name: "createSession" },
    )) as string;

    expect(findReferences).toHaveBeenCalledExactlyOnceWith(
      "src/sessions.ts",
      "createSession",
    );
    expect(JSON.parse(result)).toEqual({
      index: indexHeader,
      ...symbolReferences,
    });
  });

  it("passes the exact totals through beside the capped lists", async () => {
    const result = (await run(
      createReviewTools(makeGithub(), scope, makeIndex()),
      "find_references",
      { path: "src/sessions.ts", name: "createSession" },
    )) as string;

    const payload = JSON.parse(result);
    // The counts are the index's, not a length of what was returned.
    expect(payload.references).toHaveLength(2);
    expect(payload.totalReferences).toBe(212);
    expect(payload.totalFiles).toBe(50);
  });

  it("answers find_references in absent mode when there is no index", async () => {
    const result = (await run(
      createReviewTools(makeGithub(), scope),
      "find_references",
      { path: "src/sessions.ts" },
    )) as string;

    expect(JSON.parse(result)).toEqual({ index: ABSENT_PAYLOAD });
  });

  it.each([
    ["describe_area", { path: "src/sessions.ts" }],
    ["get_symbol", { path: "src/sessions.ts", name: "createSession" }],
    ["find_references", { path: "src/sessions.ts", name: "createSession" }],
  ])("reaches no github call for %s in either mode", async (name, input) => {
    const github = makeGithub();

    await run(createReviewTools(github, scope), name, input);
    await run(createReviewTools(github, scope, makeIndex()), name, input);

    expect(github.getFileContents).not.toHaveBeenCalled();
    expect(github.searchCode).not.toHaveBeenCalled();
    expect(github.listCommitShas).not.toHaveBeenCalled();
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

  it.each([
    ["path traversal", { path: "../../secrets/config.yml" }],
    ["absolute path", { path: "/etc/passwd" }],
    ["extra properties", { path: "src/sessions.ts", depth: 2 }],
  ])("rejects describe_area input with %s", (_label, input) => {
    const tools = createReviewTools(makeGithub(), scope, makeIndex());
    expect(schemaOf(tools, "describe_area").safeParse(input).success).toBe(false);
  });

  it.each([
    ["an empty name", { path: "src/sessions.ts", name: "" }],
    ["a missing name", { path: "src/sessions.ts" }],
    ["an over-long name", { path: "src/sessions.ts", name: "x".repeat(201) }],
    ["path traversal", { path: "../../secrets/config.yml", name: "createSession" }],
    ["an absolute path", { path: "/etc/passwd", name: "createSession" }],
    ["extra properties", { path: "src/sessions.ts", name: "a", kind: "function" }],
  ])("rejects get_symbol input with %s", (_label, input) => {
    const tools = createReviewTools(makeGithub(), scope, makeIndex());
    expect(schemaOf(tools, "get_symbol").safeParse(input).success).toBe(false);
  });

  it.each([
    ["an empty name", { path: "src/sessions.ts", name: "" }],
    ["path traversal", { path: "../../secrets/config.yml" }],
    ["an absolute path", { path: "/etc/passwd" }],
    ["extra properties", { path: "src/sessions.ts", depth: 2 }],
  ])("rejects find_references input with %s", (_label, input) => {
    const tools = createReviewTools(makeGithub(), scope, makeIndex());
    expect(schemaOf(tools, "find_references").safeParse(input).success).toBe(false);
  });

  it("accepts find_references with no name, for a file's importers", () => {
    const tools = createReviewTools(makeGithub(), scope, makeIndex());
    expect(
      schemaOf(tools, "find_references").safeParse({ path: "src/sessions.ts" })
        .success,
    ).toBe(true);
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
