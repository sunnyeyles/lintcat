import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { resolveCheckoutPath } from "#src/checkout-path";
import type { ConnectedClient } from "#src/client-capabilities";
import { resolveGithubToken, type McpEnvironment } from "#src/environment";
import { GitError } from "#src/git";
import { openLocalRepository, type LocalRepository, type LocalScope } from "#src/local-git-client";
import { openLocalMemoryStore } from "#src/local-memory-store";
import { runReview, type ReviewResult } from "#src/review";
import { selectReviewEngine } from "#src/review-engine";

/** Said whenever sampling stood in for a provider key, so nobody reads this as a full review. */
const SINGLE_SHOT_NOTICE =
  "Reduced single-shot review: no model API key is set, so this ran as one sampling request to your " +
  "client instead of the tool-calling agent. One general pass over the diff, the changed-file list and " +
  "the repository index, with no follow-up reads of the surrounding code. It is shallower than a " +
  "key-backed review and misses anything that needs reading further.";

const scopeSchema = {
  repoPath: z
    .string()
    .optional()
    .describe("Path to the git checkout; defaults to the server's working directory."),
  base: z
    .string()
    .optional()
    .describe(
      'Branch or commit to compare against, e.g. "origin/main"; defaults to the remote default branch, ' +
        'or to HEAD for scope "staged". Not allowed with a range.',
    ),
  scope: z
    .enum(["working-tree", "staged", "range"])
    .optional()
    .describe(
      'What to review: "working-tree" (default) is commits since the base plus uncommitted and ' +
        'untracked files, "staged" is only the index, "range" is the commits named by `range`.',
    ),
  range: z
    .string()
    .optional()
    .describe(
      'Commit range, e.g. "HEAD~3..HEAD", "main...feature" or a single commit. Implies scope "range".',
    ),
};

interface ScopeArgs {
  repoPath?: string | undefined;
  base?: string | undefined;
  scope?: "working-tree" | "staged" | "range" | undefined;
  range?: string | undefined;
}

function chooseScope({ scope, range }: ScopeArgs): LocalScope {
  const kind = scope ?? (range === undefined ? "working-tree" : "range");
  if (kind === "range") {
    if (range === undefined) {
      throw new GitError('scope "range" needs a `range`, e.g. "HEAD~3..HEAD"');
    }
    return { kind, range };
  }
  if (range !== undefined) {
    throw new GitError(`a \`range\` cannot be reviewed with scope "${kind}"; drop one of them`);
  }
  return { kind };
}

async function openScoped(
  environment: McpEnvironment,
  connection: ConnectedClient,
  args: ScopeArgs,
): Promise<LocalRepository> {
  return openLocalRepository(
    await resolveCheckoutPath(environment, connection, args.repoPath),
    args.base,
    chooseScope(args),
  );
}

function reviewResult(result: ReviewResult, heading: string): CallToolResult {
  const { outcome } = result;
  const details = {
    singleShot: result.singleShot,
    patches: outcome.patches,
    suppressed: outcome.suppressed,
    findings: outcome.findings,
  };
  const suppressed =
    outcome.suppressed === 0
      ? ""
      : ` ${outcome.suppressed} finding(s) were hidden by suppressions in this checkout's review memory.`;
  return {
    content: [
      ...(result.singleShot
        ? [{ type: "text" as const, text: SINGLE_SHOT_NOTICE }]
        : []),
      { type: "text", text: `${heading}${suppressed}\n\n${result.summary}` },
      { type: "text", text: JSON.stringify(details, null, 2) },
    ],
  };
}

export function registerReviewTools(
  server: McpServer,
  environment: McpEnvironment,
  connection: ConnectedClient,
): void {
  server.registerTool(
    "review_local_changes",
    {
      title: "Review local changes",
      description:
        "Run the AI review over a local checkout: by default commits since the merge-base with the " +
        "base branch plus uncommitted and untracked files, or only the staged changes, or an explicit " +
        "commit range. Returns only findings that passed the same " +
        "deterministic validation the GitHub App applies. Findings suppressed with suppress_finding are " +
        "excluded and counted. Calls the configured model provider and takes " +
        "a minute or more; nothing is written anywhere. With no provider key set, it asks you to run the " +
        "model instead (MCP sampling), which gives a reduced single-shot review the result declares.",
      inputSchema: {
        ...scopeSchema,
        index: z
          .boolean()
          .optional()
          .describe("Build the repository import index for the reviewer; on by default."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ index, ...args }, extra) => {
      const local = await openScoped(environment, connection, args);
      const files = await local.client.listChangedFiles(local.target);
      if (files.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No changes between ${local.baseRef} and ${local.scope.headLabel} of ${local.root}.`,
            },
          ],
        };
      }
      const result = await runReview(environment, {
        client: local.client,
        target: local.target,
        selected: selectReviewEngine(environment, connection),
        index,
        memory: await openLocalMemoryStore(local.root),
        signal: extra.signal,
      });
      return reviewResult(
        result,
        `Reviewed ${files.length} changed file(s) in ${local.root}: ${local.scope.headLabel} against ` +
          `${local.baseRef} (${local.baseSha.slice(0, 7)}).`,
      );
    },
  );

  server.registerTool(
    "review_pull_request",
    {
      title: "Review a GitHub pull request",
      description:
        "Run the AI review over a GitHub pull request at its current head. By default this is a dry " +
        "run that returns the validated findings and writes nothing. With publish: true it posts the " +
        "\"AI PR Review\" check run and inline review comments to the pull request, exactly as the GitHub " +
        "App does (fix commits are never made). Needs GITHUB_TOKEN or a logged-in gh CLI.",
      inputSchema: {
        owner: z.string().min(1).describe("Repository owner, e.g. \"sunnyeyles\"."),
        repo: z.string().min(1).describe("Repository name, e.g. \"pr-review-agents\"."),
        number: z.number().int().positive().describe("Pull request number."),
        publish: z
          .boolean()
          .optional()
          .describe("Post the check run and review comments to GitHub. Defaults to false."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ owner, repo, number, publish = false }, extra) => {
      const client = environment.createTokenClient({ token: await resolveGithubToken(environment) });
      const ref = { owner, repo, pullRequestNumber: number };
      const pullRequest = await client.getPullRequest(ref);
      const result = await runReview(environment, {
        client,
        target: { ...ref, headSha: pullRequest.headSha },
        selected: selectReviewEngine(environment, connection),
        ...(publish ? { publishTo: client } : {}),
        signal: extra.signal,
      });
      const where = `${owner}/${repo}#${number} at ${pullRequest.headSha.slice(0, 7)}`;
      return reviewResult(
        result,
        publish ? `Reviewed and published to ${where}.` : `Dry-run review of ${where}; nothing was posted.`,
      );
    },
  );
}
