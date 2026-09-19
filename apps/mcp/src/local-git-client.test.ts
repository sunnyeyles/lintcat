import { symlinkSync } from "node:fs";
import path from "node:path";

import { httpStatus } from "@pr-review/github";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openLocalRepository, WORKING_TREE } from "#src/local-git-client";
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

  it("never writes", async () => {
    const { client, owner, repo: name } = await openLocalRepository(repo.root, "main");

    await expect(
      client.createCheckRun({
        owner,
        repo: name,
        headSha: WORKING_TREE,
        conclusion: "neutral",
        output: { title: "", summary: "" },
      }),
    ).rejects.toThrow("not available on a local checkout");
  });
});
