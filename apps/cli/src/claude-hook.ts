/** `pr-review claude-hook`: a Claude Code PreToolUse hook that runs CI's review before a push leaves. */
import { errorMessage } from "@pr-review/logging";
import { hasModelApiKey } from "@pr-review/mcp/local-review";
import type { LocalReviewReport } from "@pr-review/schemas";

import { BYPASS_ENV } from "#src/hook";
import { parseArguments, type ReviewOptions } from "#src/options";
import { renderFinding } from "#src/render";
import { blockingOf, EXIT_OK, missingKeyMessage, reviewReport, type CliDeps } from "#src/review-command";

/** Claude Code reads exit 2 as "blocked", and shows stderr to the model. */
const EXIT_BLOCK_TOOL = 2;

// Anchored at a command's start; a flag may take one argument, as in `git -C dir push`.
const GATED = [/^git(?:\s+-\S+(?:\s+[^-\s]\S*)?)*\s+push\b/, /^gh\s+pr\s+create\b/];

/** Quoted text is blanked, so a message or pattern that mentions a push is not one. */
function isGated(command: string): boolean {
  const unquoted = command.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  return unquoted
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim().replace(/^(?:\w+=\S*\s+)*/, ""))
    .some((part) => GATED.some((pattern) => pattern.test(part)));
}

interface HookInput {
  cwd?: unknown;
  tool_input?: { command?: unknown };
}

function readInput(raw: string): HookInput {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as HookInput) : {};
  } catch {
    return {};
  }
}

function blockedMessage(report: LocalReviewReport, commandLine: string): string {
  const blocking = blockingOf(report.findings, report.failOn);
  return [
    `pr-review: blocked by ${report.blocking} finding(s) at or above ${report.failOn}, from the review CI runs on the pull request.`,
    ...blocking.map((finding) => `\n[${finding.id}]\n${renderFinding(finding, { color: false })}`),
    "",
    `Fix each one and retry. For a false positive, run \`${commandLine} suppress <id> --reason "<why>"\` first.`,
    `A human can bypass this gate with ${BYPASS_ENV}=1.`,
  ].join("\n");
}

export async function runClaudeHook(deps: CliDeps & { commandLine: string }): Promise<number> {
  const { environment, err } = deps;
  const input = readInput((await deps.stdin?.()) ?? "");
  const command = input.tool_input?.command;
  if (typeof command !== "string" || !isGated(command)) return EXIT_OK;
  if ((environment.env[BYPASS_ENV] ?? "") !== "") {
    err(`pr-review: push gate skipped (${BYPASS_ENV} is set).`);
    return EXIT_OK;
  }
  if (!hasModelApiKey(environment)) {
    err(`${missingKeyMessage()} The push was not reviewed.`);
    return EXIT_OK;
  }
  const repo = typeof input.cwd === "string" ? ["--repo", input.cwd] : [];
  const options = parseArguments(["review", "--profile", "ci", "--format", "json", ...repo]) as ReviewOptions;
  let report: LocalReviewReport;
  try {
    report = await reviewReport(options, deps);
  } catch (error: unknown) {
    err(`pr-review: ${errorMessage(error)}. The push was not reviewed.`);
    return EXIT_OK;
  }
  if (report.blocking === 0) return EXIT_OK;
  err(blockedMessage(report, deps.commandLine));
  return EXIT_BLOCK_TOOL;
}
