import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  branchExists,
  changedFiles,
  checkpointCommit,
  createWorktree,
  currentBranch,
  diffStat,
  ensureFactoryExcluded,
  hasRemote,
  headSha,
  isClean,
  pushBranch,
  repoRoot,
  resetTo,
  slugify,
  squashSince,
} from "#src/git";

const run = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

let root: string;
let repo: string;
let base: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "factory-git-")));
  repo = join(root, "repo");
  execFileSync("git", ["init", "--quiet", "-b", "main", repo]);
  run(repo, "config", "user.name", "Factory Test");
  run(repo, "config", "user.email", "factory@example.com");
  run(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "README.md"), "hello\n");
  run(repo, "add", "-A");
  run(repo, "commit", "--quiet", "-m", "init");
  base = run(repo, "rev-parse", "HEAD");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const worktreePath = () => join(repo, ".factory", "worktrees", "run-1");

describe("git", () => {
  it("reads repo facts", async () => {
    expect(await repoRoot(repo)).toBe(repo);
    expect(await headSha(repo)).toBe(base);
    expect(await currentBranch(repo)).toBe("main");
    expect(await isClean(repo)).toBe(true);
    expect(await branchExists(repo, "main")).toBe(true);
    expect(await branchExists(repo, "nope")).toBe(false);
    run(repo, "checkout", "--quiet", "--detach");
    expect(await currentBranch(repo)).toBeNull();
  });

  it("creates a worktree once and attaches to an existing branch", async () => {
    const path = worktreePath();
    expect(await createWorktree(repo, { path, branch: "factory/a", baseSha: base })).toEqual({ created: true });
    expect(await createWorktree(repo, { path, branch: "factory/a", baseSha: base })).toEqual({ created: false });
    expect(await currentBranch(path)).toBe("factory/a");
    await expect(createWorktree(repo, { path, branch: "factory/b", baseSha: base })).rejects.toThrow(/factory\/a/);

    run(repo, "branch", "factory/c", base);
    const other = join(repo, ".factory", "worktrees", "run-2");
    expect(await createWorktree(repo, { path: other, branch: "factory/c", baseSha: base })).toEqual({ created: true });
    expect(await currentBranch(other)).toBe("factory/c");
  });

  it("checkpoints only when something changed, without trailers", async () => {
    expect(await checkpointCommit(repo, "nothing")).toBeNull();
    writeFileSync(join(repo, "a.txt"), "a\n");
    const sha = await checkpointCommit(repo, "add a", { name: "Bot", email: "bot@example.com" });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(run(repo, "log", "-1", "--format=%B")).toBe("add a");
    expect(run(repo, "log", "-1", "--format=%an|%cn")).toBe("Bot|Factory Test");
    expect(await changedFiles(repo, base)).toEqual(["a.txt"]);
  });

  it("refuses resetTo outside a factory worktree", async () => {
    await expect(resetTo(repo, base)).rejects.toThrow(/factory worktree/);
  });

  it("resetTo restores a dirty factory worktree but keeps ignored files", async () => {
    const path = worktreePath();
    await createWorktree(repo, { path, branch: "factory/a", baseSha: base });
    writeFileSync(join(path, ".gitignore"), "node_modules/\n");
    await checkpointCommit(path, "ignore");
    const sha = await headSha(path);
    writeFileSync(join(path, "README.md"), "changed\n");
    writeFileSync(join(path, "stray.txt"), "x\n");
    mkdirSync(join(path, "node_modules"), { recursive: true });
    writeFileSync(join(path, "node_modules", "dep.js"), "1\n");

    await resetTo(path, sha);
    expect(readFileSync(join(path, "README.md"), "utf8")).toBe("hello\n");
    expect(existsSync(join(path, "stray.txt"))).toBe(false);
    expect(existsSync(join(path, "node_modules", "dep.js"))).toBe(true);
    expect(await isClean(path)).toBe(true);
  });

  it("squashes commits since base into one, idempotently", async () => {
    writeFileSync(join(repo, "a.txt"), "a\n");
    await checkpointCommit(repo, "one");
    writeFileSync(join(repo, "b.txt"), "b\n");
    await checkpointCommit(repo, "two");

    const squashed = await squashSince(repo, base, "Add a and b");
    expect(run(repo, "rev-list", "--count", `${base}..HEAD`)).toBe("1");
    expect(run(repo, "log", "-1", "--format=%B")).toBe("Add a and b");
    expect(await squashSince(repo, base, "Add a and b")).toBe(squashed);
    expect(await diffStat(repo, base)).toMatchObject({ files: 2, insertions: 2, deletions: 0 });
  });

  it("excludes .factory/ idempotently via info/exclude", async () => {
    await ensureFactoryExcluded(repo);
    await ensureFactoryExcluded(repo);
    const exclude = readFileSync(join(repo, ".git", "info", "exclude"), "utf8");
    expect(exclude.match(/^\.factory\/$/gm)).toHaveLength(1);
    expect(existsSync(join(repo, ".gitignore"))).toBe(false);
    writeFileSync(join(repo, "x.txt"), "x\n");
    mkdirSync(join(repo, ".factory", "runs"), { recursive: true });
    writeFileSync(join(repo, ".factory", "runs", "state.json"), "{}\n");
    expect(run(repo, "status", "--porcelain")).toBe("?? x.txt");
  });

  it("pushes feature branches but refuses main", async () => {
    const remote = join(root, "remote.git");
    execFileSync("git", ["init", "--quiet", "--bare", remote]);
    run(repo, "remote", "add", "origin", remote);
    expect(await hasRemote(repo, "origin")).toBe(true);
    expect(await hasRemote(repo, "upstream")).toBe(false);

    await expect(pushBranch(repo, "origin", "main")).rejects.toThrow(/protected/);
    await expect(pushBranch(repo, "origin", "master")).rejects.toThrow(/protected/);
    run(repo, "branch", "factory/x");
    await pushBranch(repo, "origin", "factory/x");
    expect(run(remote, "rev-parse", "factory/x")).toBe(base);
  });

  it("slugifies titles", () => {
    expect(slugify("Fix the Login Bug!!")).toBe("fix-the-login-bug");
    expect(slugify("  ")).toBe("task");
    const long = slugify("a very long title that keeps going well past forty characters");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
  });
});
