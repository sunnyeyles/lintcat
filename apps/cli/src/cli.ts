/**
 * `pr-review`: the reviewer as a plain command, for a git hook, a pre-commit
 * framework or a CI step. Findings come back validated or not at all.
 */
import path from "node:path";

import { errorMessage } from "@pr-review/logging";

import { BYPASS_ENV, installPrePushHook } from "#src/hook";
import { parseArguments, UsageError, type Command } from "#src/options";
import {
  EXIT_ERROR,
  EXIT_OK,
  runReviewCommand,
  type CliDeps,
} from "#src/review-command";

export const VERSION = "0.1.0";

export const USAGE = `pr-review — review a working tree before it is pushed.

Usage:
  pr-review [review] [options]      Review a checkout and report validated findings
  pr-review install-hook [options]  Install the pre-push hook into a checkout
  pr-review help | version

Review options:
  --repo <path>        Checkout to review (default: the working directory)
  --base <ref>         Branch or commit to compare against (default: the remote default branch)
  --scope <kind>       working-tree (default), staged, or range
  --range <range>      Commits to review, e.g. HEAD~3..HEAD; implies --scope range
  --agents <list>      Comma-separated agent categories (default: the repository's own)
  --fail-on <level>    Exit non-zero at this severity or above: low, medium, high (default), off
  --no-index           Skip the repository import index
  --no-progress        Do not report each agent starting and finishing
  --verbose            Let the review's structured log through to stderr
  --color / --no-color Force colour on or off (default: on for a terminal, off otherwise)

install-hook options:
  --repo <path>        Checkout to install into (default: the working directory)
  --fail-on <level>    Severity the hook blocks a push on (default: high)
  --command <command>  What the hook runs (default: the command that installed it)
  --force              Replace a pre-push hook pr-review did not write

Exit codes:
  0  no finding at or above --fail-on
  1  at least one finding at or above --fail-on
  2  the review could not run
  3  the review was cancelled (Ctrl-C or SIGTERM); a second interrupt quits at once

Bypass the installed hook with ${BYPASS_ENV}=1 git push, or git push --no-verify.
A model API key (ANTHROPIC_API_KEY or OPENAI_API_KEY) must be set before a review runs.`;

export interface CliEnvironment extends CliDeps {
  /** Whether stdout is a terminal; decides colour unless a flag says otherwise. */
  isTty?: boolean | undefined;
  /** How this process was launched, for a hook that must run it again later. */
  commandLine: string;
}

/** Colour when the caller asked for it, else only for a terminal that allows it. */
function useColor(deps: CliEnvironment, asked: boolean | undefined): boolean {
  if (asked !== undefined) return asked;
  return deps.isTty === true && (deps.environment.env["NO_COLOR"] ?? "") === "";
}

async function dispatch(command: Command, deps: CliEnvironment): Promise<number> {
  if (command.kind === "help") {
    deps.out(USAGE);
    return EXIT_OK;
  }
  if (command.kind === "version") {
    deps.out(VERSION);
    return EXIT_OK;
  }
  if (command.kind === "review") {
    return runReviewCommand({ ...command, color: useColor(deps, command.color) }, deps);
  }
  const installed = await installPrePushHook({
    repoPath: path.resolve(deps.environment.cwd, command.repoPath ?? "."),
    command: command.command ?? deps.commandLine,
    failOn: command.failOn,
    force: command.force,
  });
  deps.out(
    `${installed.replaced ? "Replaced" : "Installed"} the pre-push hook at ${installed.path}; ` +
      `it blocks a push on a ${command.failOn} finding. Bypass with ${BYPASS_ENV}=1 git push.`,
  );
  return EXIT_OK;
}

/** Runs one command line. Returns the process exit code; throws nothing. */
export async function runCli(argv: readonly string[], deps: CliEnvironment): Promise<number> {
  try {
    return await dispatch(parseArguments(argv), deps);
  } catch (error: unknown) {
    deps.err(`pr-review: ${errorMessage(error)}`);
    if (error instanceof UsageError) {
      deps.err("");
      deps.err(USAGE);
    }
    return EXIT_ERROR;
  }
}
