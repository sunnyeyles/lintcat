import { execFile } from "node:child_process";

/** A failed git command; `status` 404 marks a path or ref that does not exist. */
export class GitError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GitError";
  }
}

interface GitOptions {
  /** Exit codes that still mean success, e.g. 1 from `git grep` with no match. */
  okExitCodes?: readonly number[];
  maxBuffer?: number;
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

function runGit<T extends string | Buffer>(
  cwd: string,
  args: readonly string[],
  encoding: "utf8" | "buffer",
  options: GitOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-c", "core.quotePath=false", ...args],
      { cwd, encoding, maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER },
      (error, stdout, stderr) => {
        const code = (error as { code?: unknown } | null)?.code;
        if (error && !(typeof code === "number" && options.okExitCodes?.includes(code))) {
          const detail = String(stderr).trim() || error.message;
          reject(new GitError(`git ${args[0]} failed: ${detail}`));
          return;
        }
        resolve(stdout as T);
      },
    );
  });
}

export function git(cwd: string, args: readonly string[], options: GitOptions = {}): Promise<string> {
  return runGit<string>(cwd, args, "utf8", options);
}

export function gitBuffer(
  cwd: string,
  args: readonly string[],
  options: GitOptions = {},
): Promise<Buffer> {
  return runGit<Buffer>(cwd, args, "buffer", options);
}

/** Refuses a ref that git would read as an option. */
export function assertRef(ref: string): string {
  if (ref === "" || ref.startsWith("-") || /[\s\0]/.test(ref)) {
    throw new GitError(`not a usable git ref: ${JSON.stringify(ref)}`);
  }
  return ref;
}
