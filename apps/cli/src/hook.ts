/** The pre-push hook: the same review, run before anything leaves the machine. */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { git, repositoryRoot } from "@pr-review/mcp/local-review";

import type { FailOn } from "#src/options";

/** Set in the environment of one `git push` to skip the review. */
export const BYPASS_ENV = "PR_REVIEW_SKIP";

/** How an installed hook identifies itself, so an upgrade replaces only our own. */
export const HOOK_MARKER = "# pr-review-agents pre-push hook";

export function hookScript(command: string, failOn: FailOn): string {
  return [
    "#!/bin/sh",
    HOOK_MARKER,
    `# Bypass: ${BYPASS_ENV}=1 git push, or git push --no-verify.`,
    `if [ -n "\${${BYPASS_ENV}:-}" ]; then`,
    `  echo "pr-review: review skipped (${BYPASS_ENV} is set)" >&2`,
    "  exit 0",
    "fi",
    `${command} review --fail-on ${failOn} || {`,
    "  status=$?",
    `  echo "pr-review: push blocked. Bypass with ${BYPASS_ENV}=1 git push, or git push --no-verify." >&2`,
    "  exit $status",
    "}",
    "exit 0",
    "",
  ].join("\n");
}

export interface InstalledHook {
  path: string;
  /** An earlier hook this command had written was overwritten. */
  replaced: boolean;
}

export interface InstallHookRequest {
  repoPath: string;
  command: string;
  failOn: FailOn;
  /** Overwrite a pre-push hook this command did not write. */
  force: boolean;
}

/** Honours core.hooksPath, so a repository that moved its hooks still gets one. */
async function hooksDirectory(root: string): Promise<string> {
  return path.resolve(root, (await git(root, ["rev-parse", "--git-path", "hooks"])).trim());
}

function existingHook(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function installPrePushHook({
  repoPath,
  command,
  failOn,
  force,
}: InstallHookRequest): Promise<InstalledHook> {
  const root = await repositoryRoot(repoPath);
  const directory = await hooksDirectory(root);
  const file = path.join(directory, "pre-push");
  const existing = existingHook(file);
  const ours = existing?.includes(HOOK_MARKER) ?? false;
  if (existing !== undefined && !ours && !force) {
    throw new Error(
      `${file} already exists and was not written by pr-review. Re-run with --force to replace it, ` +
        `or call \`${command} review --fail-on ${failOn}\` from the hook you have.`,
    );
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(file, hookScript(command, failOn), "utf8");
  chmodSync(file, 0o755);
  return { path: file, replaced: existing !== undefined };
}
