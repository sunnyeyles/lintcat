import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test Author",
  GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Author",
  GIT_COMMITTER_EMAIL: "author@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export interface TestRepo {
  root: string;
  git: (...args: string[]) => string;
  write: (file: string, content: string) => void;
  commit: (message: string) => void;
  remove: () => void;
}

/** A throwaway repository on `main`; every write lands relative to its root. */
export function createTestRepo(files: Record<string, string>): TestRepo {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pr-review-mcp-")));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env: GIT_ENV, encoding: "utf8" });
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
  };

  git("init", "-q", "-b", "main");
  for (const [file, content] of Object.entries(files)) write(file, content);
  commit("initial");
  return { root, git, write, commit, remove: () => rmSync(root, { recursive: true, force: true }) };
}
