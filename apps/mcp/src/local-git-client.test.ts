import { symlinkSync } from "node:fs";
import path from "node:path";

import { httpStatus } from "@pr-review/github";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  openLocalRepository,
  searchWorkingTree,
  WORKING_TREE,
} from "#src/local-git-client";
import { createTestRepo, type TestRepo } from "#src/test-repo";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo({
    "src/sessions.ts": "export const sessions = [];\n",
    "src/api.ts": 'import { sessions } from "./sessions";\n',
    "node_modules/dep/index.js": "module.exports = 1;\n",
  });
  repo.git("checkout", "-q", "-b", "feature");
  repo.write("src/api.ts", 'import { sessions } from "./sessions";\nexport const count = sessions.length;\n');
  repo.commit("count sessions");
  repo.write("src/sessions.ts", "export const sessions: string[] = [];\n");
  repo.write("src/draft.ts", "export const draft = true;\n");
});

afterEach(() => repo.remove());

describe("openLocalRepository", () => {
  it("compares the working tree against the merge-base with the base branch", async () => {
    const local = await openLocalRepository(repo.root, "main");

    expect(local.baseSha).toBe(repo.git("rev-parse", "main").trim());
    expect(local.branch).toBe("feature");
    expect(local.target.headSha).toBe(WORKING_TREE);
    const files = await local.client.listChangedFiles(local.target);
    expect(files.map((file) => [file.filename, file.status])).toEqual([
      ["src/api.ts", "modified"],
      ["src/sessions.ts", "modified"],
      ["src/draft.ts", "added"],
    ]);
    expect(await local.client.getDiff(local.target)).toContain("+export const draft = true;");
  });

  it("keeps real paths whatever diff prefix the user's git config sets", async () => {
    repo.git("config", "diff.mnemonicPrefix", "true");
    repo.git("config", "diff.noprefix", "true");
    const local = await openLocalRepository(repo.root, "main");

    const files = await local.client.listChangedFiles(local.target);
    expect(files.map((file) => file.filename)).toEqual(["src/api.ts", "src/sessions.ts", "src/draft.ts"]);
  });

  it("skips a nested repository and diffs many untracked files without a process each", async () => {
    const nested = createTestRepo({ "inner.ts": "export {};\n" });
    repo.git("clone", "-q", nested.root, "vendor-checkout");
    nested.remove();
    for (let i = 0; i < 2000; i++) repo.write(`generated/file-${i}.ts`, `export const n = ${i};\n`);
    const local = await openLocalRepository(repo.root, "main");

    const files = await local.client.listChangedFiles(local.target);
    expect(files).toHaveLength(2003);
    expect(files.some((file) => file.filename.startsWith("vendor-checkout"))).toBe(false);
  });

  it("describes the branch as a pull request with its commits in the body", async () => {
    const local = await openLocalRepository(repo.root, "main");
    const pullRequest = await local.client.getPullRequest(local.target);

    expect(pullRequest).toMatchObject({
      title: "Local changes on feature",
      baseRef: "main",
      headRef: "feature",
      headSha: WORKING_TREE,
    });
    expect(pullRequest.body).toContain("- count sessions");
  });

  it("refuses a base that git would read as an option", async () => {
    await expect(openLocalRepository(repo.root, "--output=/tmp/x")).rejects.toThrow("not a usable git ref");
  });
});

describe("the staged scope", () => {
  const staged = { kind: "staged" } as const;

  it("reviews the index against HEAD, ignoring unstaged and untracked work", async () => {
    repo.git("add", "src/sessions.ts");
    const local = await openLocalRepository(repo.root, undefined, staged);

    expect(local.baseSha).toBe(repo.git("rev-parse", "HEAD").trim());
    expect(local.target.headSha).not.toBe(WORKING_TREE);
    const files = await local.client.listChangedFiles(local.target);
    expect(files.map((file) => file.filename)).toEqual(["src/sessions.ts"]);
  });

  it("reads a staged file at the head, not as the working tree has it since", async () => {
    repo.git("add", "src/sessions.ts");
    const { client, owner, repo: name, target } = await openLocalRepository(repo.root, undefined, staged);
    repo.write("src/sessions.ts", "export const sessions: never[] = [];\n");

    const contents = await client.getFileContents({
      owner,
      repo: name,
      path: "src/sessions.ts",
      ref: target.headSha,
    });
    expect(contents).toBe("export const sessions: string[] = [];\n");
  });

  it("reports nothing staged as an empty change list", async () => {
    const local = await openLocalRepository(repo.root, undefined, staged);

    await expect(local.client.listChangedFiles(local.target)).resolves.toEqual([]);
    await expect(local.client.listPullRequestCommitShas(local.target)).resolves.toEqual([]);
  });

  it("archives the staged tree even though it is not a commit", async () => {
    repo.git("add", "src/draft.ts");
    const { client, owner, repo: name, target } = await openLocalRepository(repo.root, undefined, staged);

    const archive = await client.getRepositoryArchive({ owner, repo: name, ref: target.headSha });
    expect([...archive.files.keys()]).toContain("src/draft.ts");
  });
});

describe("the range scope", () => {
  const range = (spec: string) => openLocalRepository(repo.root, undefined, { kind: "range", range: spec });

  it("diffs the two ends of an explicit range, ignoring the working tree", async () => {
    const local = await range("main..feature");

    expect(local.baseSha).toBe(repo.git("rev-parse", "main").trim());
    expect(local.target.headSha).toBe(repo.git("rev-parse", "feature").trim());
    const files = await local.client.listChangedFiles(local.target);
    expect(files.map((file) => file.filename)).toEqual(["src/api.ts"]);
  });

  it("lists the commits in the range and names them in the pull request body", async () => {
    const local = await range("main..feature");

    const shas = await local.client.listPullRequestCommitShas(local.target);
    expect(shas).toEqual([repo.git("rev-parse", "feature").trim()]);
    const pullRequest = await local.client.getPullRequest(local.target);
    expect(pullRequest.body).toContain("- count sessions");
    expect(pullRequest.title).toContain("Commits main..");
  });

  it("starts a three-dot range at the merge-base", async () => {
    repo.git("checkout", "-q", "main");
    repo.write("src/unrelated.ts", "export const unrelated = true;\n");
    repo.commit("unrelated");
    repo.git("checkout", "-q", "feature");
    const local = await range("main...feature");

    const files = await local.client.listChangedFiles(local.target);
    expect(files.map((file) => file.filename)).toEqual(["src/api.ts"]);
  });

  it("reads a bare commit as that commit against its parent", async () => {
    const local = await range("feature");

    const files = await local.client.listChangedFiles(local.target);
    expect(files.map((file) => file.filename)).toEqual(["src/api.ts"]);
  });

  it("reports an empty range as no changes at all", async () => {
    const local = await range("feature..feature");

    await expect(local.client.listChangedFiles(local.target)).resolves.toEqual([]);
    await expect(local.client.getDiff(local.target)).resolves.toBe("");
  });

  it("names an unknown ref rather than guessing", async () => {
    await expect(range("main..nope")).rejects.toThrow('unknown commit "nope" in this checkout');
  });

  it("rejects a malformed range", async () => {
    for (const spec of ["main..", "..main", "   "]) {
      await expect(range(spec), spec).rejects.toThrow(/malformed commit range|unknown commit/);
    }
  });

  it("refuses a base alongside a range, which already names one", async () => {
    await expect(
      openLocalRepository(repo.root, "main", { kind: "range", range: "main..feature" }),
    ).rejects.toThrow("already names its base");
  });
});

describe("the local client", () => {
  it("reads a file at the base commit and from the working tree", async () => {
    const { client, owner, repo: name, baseSha } = await openLocalRepository(repo.root, "main");
    const read = (ref: string) => client.getFileContents({ owner, repo: name, path: "src/sessions.ts", ref });

    await expect(read(baseSha)).resolves.toBe("export const sessions = [];\n");
    await expect(read(WORKING_TREE)).resolves.toBe("export const sessions: string[] = [];\n");
  });

  it("reports a missing file as a 404, so optional config reads as absent", async () => {
    const { client, owner, repo: name, baseSha } = await openLocalRepository(repo.root, "main");

    const error = await client
      .getFileContents({ owner, repo: name, path: ".github/pr-review-agents.yml", ref: baseSha })
      .catch((caught: unknown) => caught);
    expect(httpStatus(error)).toBe(404);
  });

  it("will not follow a symlink out of the checkout", async () => {
    symlinkSync("/etc/hosts", path.join(repo.root, "src/hosts"));
    const { client, owner, repo: name } = await openLocalRepository(repo.root, "main");

    const error = await client
      .getFileContents({ owner, repo: name, path: "src/hosts", ref: WORKING_TREE })
      .catch((caught: unknown) => caught);
    expect(httpStatus(error)).toBe(404);
  });

  it("archives the base commit and the working tree, skipping vendored directories", async () => {
    const { client, owner, repo: name, baseSha } = await openLocalRepository(repo.root, "main");

    const base = await client.getRepositoryArchive({ owner, repo: name, ref: baseSha });
    expect(base.sha).toBe(baseSha);
    expect([...base.files.keys()].sort()).toEqual(["src/api.ts", "src/sessions.ts"]);

    const tree = await client.getRepositoryArchive({ owner, repo: name, ref: WORKING_TREE });
    expect([...tree.files.keys()].sort()).toEqual(["src/api.ts", "src/draft.ts", "src/sessions.ts"]);
  });

  it("searches tracked and untracked files", async () => {
    const { client, owner, repo: name } = await openLocalRepository(repo.root, "main");

    const result = await client.searchCode({ owner, repo: name, query: "export const" });
    expect(result.matches.map((match) => match.path).sort()).toEqual([
      "src/api.ts",
      "src/draft.ts",
      "src/sessions.ts",
    ]);
  });

  it("declares nothing a checkout cannot honour, so a write cannot be called", async () => {
    const { client } = await openLocalRepository(repo.root, "main");

    for (const method of [
      "compareCommits",
      "createCheckRun",
      "createReview",
      "createCommitOnBranch",
      "writeFileOnBranch",
    ]) {
      expect(method in client, method).toBe(false);
    }
  });
});

describe("searchWorkingTree", () => {
  beforeEach(() => {
    repo.write(
      "src/search.ts",
      [
        "const alpha = 1;",
        "const beta = 2;",
        "const sum = alpha + beta;",
        'const phrase = "alpha beta";',
        "",
      ].join("\n"),
    );
  });

  it("reports one entry per matching line, with its path and line number", async () => {
    const hits = await searchWorkingTree(repo.root, "sum");

    expect(hits).toEqual([
      { path: "src/search.ts", line: 3, text: "const sum = alpha + beta;" },
    ]);
  });

  it("keeps only the lines holding every term, not every line of a file that does", async () => {
    const hits = await searchWorkingTree(repo.root, "alpha beta");

    expect(hits.map((hit) => hit.line)).toEqual([3, 4]);
  });

  it("reads a quoted phrase as one term, as the shared query grammar does", async () => {
    const hits = await searchWorkingTree(repo.root, '"alpha beta"');

    expect(hits.map((hit) => hit.line)).toEqual([4]);
  });

  it("matches without regard to case, and never as a regular expression", async () => {
    await expect(searchWorkingTree(repo.root, "CONST ALPHA")).resolves.toHaveLength(3);
    await expect(searchWorkingTree(repo.root, "alph.")).resolves.toEqual([]);
  });

  it("limits the search to the given path", async () => {
    const hits = await searchWorkingTree(repo.root, "sessions", "src/api.ts");

    expect(hits.every((hit) => hit.path === "src/api.ts")).toBe(true);
    expect(hits.length).toBeGreaterThan(0);
  });

  it("returns nothing for a query with no terms", async () => {
    await expect(searchWorkingTree(repo.root, "   ")).resolves.toEqual([]);
  });
});
