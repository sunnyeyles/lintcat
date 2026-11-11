import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`git ${args.join(" ")} failed (${exitCode ?? "signal"}): ${stderr.trim()}`);
    this.name = "GitError";
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const e = error as { code?: number | string; stderr?: string };
    throw new GitError(args, typeof e.code === "number" ? e.code : null, e.stderr ?? String(error));
  }
}

async function gitOk(cwd: string, args: readonly string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch (error) {
    if (error instanceof GitError && error.exitCode !== null) return false;
    throw error;
  }
}

export async function repoRoot(path: string): Promise<string> {
  return (await git(path, ["rev-parse", "--show-toplevel"])).trim();
}

export async function headSha(dir: string): Promise<string> {
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

export async function currentBranch(dir: string): Promise<string | null> {
  try {
    return (await git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
  } catch (error) {
    if (error instanceof GitError && error.exitCode === 1) return null;
    throw error;
  }
}

export async function isClean(dir: string): Promise<boolean> {
  return (await git(dir, ["status", "--porcelain"])).trim() === "";
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  return gitOk(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
}

async function samePath(a: string, b: string): Promise<boolean> {
  const real = async (p: string) => realpath(p).catch(() => resolve(p));
  return (await real(a)) === (await real(b));
}

export async function createWorktree(
  repo: string,
  options: { path: string; branch: string; baseSha: string },
): Promise<{ created: boolean }> {
  const { path, branch, baseSha } = options;
  if (existsSync(path)) {
    const listed = await git(repo, ["worktree", "list", "--porcelain"]);
    for (const block of listed.split("\n\n")) {
      const worktree = /^worktree (.+)$/m.exec(block)?.[1];
      if (!worktree || !(await samePath(worktree, path))) continue;
      const head = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
      if (head === branch) return { created: false };
      throw new Error(`worktree ${path} exists on ${head ?? "a detached HEAD"}, not ${branch}`);
    }
    throw new Error(`${path} exists and is not a worktree of ${repo}`);
  }
  await mkdir(dirname(path), { recursive: true });
  if (await branchExists(repo, branch)) await git(repo, ["worktree", "add", path, branch]);
  else await git(repo, ["worktree", "add", "-b", branch, path, baseSha]);
  return { created: true };
}

export async function checkpointCommit(
  dir: string,
  message: string,
  author?: { name: string; email: string },
  exclude: readonly string[] = [],
): Promise<string | null> {
  await git(dir, ["add", "-A", "--", ".", ...exclude.map((path) => `:(exclude)${path}`)]);
  if (await gitOk(dir, ["diff", "--cached", "--quiet"])) return null;
  const authorArgs = author ? [`--author=${author.name} <${author.email}>`] : [];
  await git(dir, ["commit", "--quiet", "--no-edit", ...authorArgs, "-m", message]);
  return headSha(dir);
}

function assertFactoryWorktree(dir: string): void {
  if (!`${resolve(dir)}/`.includes("/.factory/worktrees/")) {
    throw new Error(`refusing destructive git operation outside a factory worktree: ${dir}`);
  }
}

// Plain `clean -fd` keeps ignored files such as node_modules.
export async function resetTo(dir: string, sha: string): Promise<void> {
  assertFactoryWorktree(dir);
  await git(dir, ["reset", "--hard", "--quiet", sha]);
  await git(dir, ["clean", "-fdq"]);
}

export async function squashSince(dir: string, baseSha: string, message: string): Promise<string> {
  const count = Number((await git(dir, ["rev-list", "--count", `${baseSha}..HEAD`])).trim());
  if (count === 1) {
    const subject = (await git(dir, ["log", "-1", "--format=%B"])).trim();
    if (subject === message.trim()) return headSha(dir);
  }
  await git(dir, ["reset", "--soft", "--quiet", baseSha]);
  if (await gitOk(dir, ["diff", "--cached", "--quiet"])) return headSha(dir);
  await git(dir, ["commit", "--quiet", "--no-edit", "-m", message]);
  return headSha(dir);
}

export type DiffStat = { files: number; insertions: number; deletions: number; summary: string };

/** Tracked changes from `baseSha` to the working tree; untracked files are not counted. */
export async function diffStat(dir: string, baseSha: string): Promise<DiffStat> {
  const numstat = (await git(dir, ["diff", "--numstat", baseSha])).trim();
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat ? numstat.split("\n") : []) {
    const [added, removed] = line.split("\t");
    files += 1;
    insertions += Number(added) || 0;
    deletions += Number(removed) || 0;
  }
  const summary = (await git(dir, ["diff", "--shortstat", baseSha])).trim();
  return { files, insertions, deletions, summary };
}

/** Committed, staged, unstaged and untracked paths that differ from `baseSha`, sorted. */
export async function changedFiles(dir: string, baseSha: string): Promise<string[]> {
  const tracked = await git(dir, ["diff", "--name-only", "-z", baseSha]);
  const untracked = await git(dir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const all = new Set([...tracked.split("\0"), ...untracked.split("\0")].filter(Boolean));
  return [...all].sort();
}

/** Uncommitted paths, with untracked directories collapsed to one entry. */
export async function dirtyPaths(dir: string): Promise<string[]> {
  const out = await git(dir, ["status", "--porcelain", "-z", "--untracked-files=normal"]);
  const paths: string[] = [];
  const entries = out.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i++;
  }
  return paths.sort();
}

export async function ensureFactoryExcluded(repo: string): Promise<void> {
  const raw = (await git(repo, ["rev-parse", "--git-common-dir"])).trim();
  const commonDir = isAbsolute(raw) ? raw : resolve(repo, raw);
  const excludePath = join(commonDir, "info", "exclude");
  const existing = await readFile(excludePath, "utf8").catch(() => "");
  const present = existing.split(/\r?\n/).some((line) => line.trim() === ".factory/");
  if (!present) {
    await mkdir(dirname(excludePath), { recursive: true });
    const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
    await appendFile(excludePath, `${separator}.factory/\n`);
  }
  if (!(await gitOk(repo, ["check-ignore", "-q", ".factory/probe"]))) {
    throw new Error(`.factory/ is still not ignored in ${repo}; a negating rule may override it`);
  }
}

export async function hasRemote(repo: string, name: string): Promise<boolean> {
  const remotes = (await git(repo, ["remote"])).split("\n").map((r) => r.trim());
  return remotes.includes(name);
}

async function remoteDefaultBranch(dir: string, remote: string): Promise<string | null> {
  try {
    const ref = (await git(dir, ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`])).trim();
    return ref.replace(`refs/remotes/${remote}/`, "");
  } catch {
    return null;
  }
}

export async function pushBranch(dir: string, remote: string, branch: string): Promise<void> {
  const protectedBranches = new Set(["main", "master"]);
  const remoteDefault = await remoteDefaultBranch(dir, remote);
  if (remoteDefault) protectedBranches.add(remoteDefault);
  if (protectedBranches.has(branch)) throw new Error(`refusing to push to protected branch ${branch}`);
  await git(dir, ["push", "--quiet", "-u", remote, `refs/heads/${branch}:refs/heads/${branch}`]);
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "task";
}
