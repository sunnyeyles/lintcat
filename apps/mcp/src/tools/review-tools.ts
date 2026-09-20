import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { AgentLifecycleListener } from "@pr-review/ai";
import { z } from "zod";

import { listAgents, type AgentListing } from "#src/agent-listing";
import { resolveGithubToken, type McpEnvironment } from "#src/environment";
import { openLocalRepository } from "#src/local-git-client";
import { openLocalMemoryStore } from "#src/local-memory-store";
import { runReview, type ReviewResult } from "#src/review";

const agentsSchema = z
  .string()
  .optional()
  .describe(
    'Comma-separated agent categories, e.g. "security,correctness". Omit to run the repository\'s configured agents.',
  );

function reviewResult(result: ReviewResult, heading: string): CallToolResult {
  const { outcome } = result;
  const details = {
    agents: result.agents,
    agentFailures: outcome.agentFailures,
    synthesis: outcome.synthesis.outcome,
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
      { type: "text", text: `${heading}${suppressed}\n\n${result.summary}` },
      { type: "text", text: JSON.stringify(details, null, 2) },
    ],
  };
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Reports agent progress to the caller; undefined when it sent no progress token. */
function progressReporter(extra: ToolExtra): AgentLifecycleListener | undefined {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) {
    return undefined;
  }
  return ({ agent, phase, finished, total }) => {
    // A dropped notification must not disturb the review that is still running.
    void extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress: finished, total, message: `${agent} ${phase}` },
      })
      .catch(() => undefined);
  };
}

/** The one-line headline above the listing's JSON. */
function agentHeadline(listing: AgentListing): string {
  const woken = listing.agents.filter((agent) => agent.wakes).map((agent) => agent.category);
  const source = listing.configured
    ? `${listing.configPath} at ${listing.baseSha.slice(0, 7)}`
    : `no ${listing.configPath}, so these are the defaults`;
  const wakes =
    woken.length === 0
      ? "none would run on the current changes"
      : `${woken.join(", ")} would run on the current changes`;
  return `${listing.agents.length} agent(s) from ${source}; ${wakes}.`;
}

export function registerReviewTools(server: McpServer, environment: McpEnvironment): void {
  server.registerTool(
    "list_review_agents",
    {
      title: "List the review agents",
      description:
        "List the review agents configured for a local checkout: each agent's category, its path gate, " +
        "and whether the working tree's current changes would wake it. Reads the configuration at the " +
        "base commit exactly as a review does, so an uncommitted config is not yet in effect. A " +
        "repository with no configuration gets the default agent. Makes no model or network calls.",
      inputSchema: {
        repoPath: z
          .string()
          .optional()
          .describe("Path to the git checkout; defaults to the server's working directory."),
        base: z
          .string()
          .optional()
          .describe('Branch or commit to compare against, e.g. "origin/main"; defaults to the remote default branch.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ repoPath, base }) => {
      const local = await openLocalRepository(path.resolve(environment.cwd, repoPath ?? "."), base);
      const listing = await listAgents(local);
      return {
        content: [
          { type: "text", text: agentHeadline(listing) },
          { type: "text", text: JSON.stringify(listing, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "review_local_changes",
    {
      title: "Review local changes",
      description:
        "Run the AI review agents over a local checkout's changes against its base branch: commits since " +
        "the merge-base plus uncommitted and untracked files. Returns only findings that passed the same " +
        "deterministic validation the GitHub Action applies. Findings suppressed with suppress_finding are " +
        "excluded and counted. Calls the configured model provider and takes a minute or more; nothing is written.",
      inputSchema: {
        repoPath: z
          .string()
          .optional()
          .describe("Path to the git checkout; defaults to the server's working directory."),
        base: z
          .string()
          .optional()
          .describe('Branch or commit to compare against, e.g. "origin/main"; defaults to the remote default branch.'),
        agents: agentsSchema,
        index: z
          .boolean()
          .optional()
          .describe("Build the repository import index for the agents; on by default."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ repoPath, base, agents, index }, extra) => {
      const local = await openLocalRepository(
        path.resolve(environment.cwd, repoPath ?? "."),
        base,
      );
      const files = await local.client.listChangedFiles(local.target);
      if (files.length === 0) {
        return {
          content: [
            { type: "text", text: `No changes between ${local.baseRef} and the working tree of ${local.root}.` },
          ],
        };
      }
      const result = await runReview(environment, {
        client: local.client,
        target: local.target,
        baseSha: local.baseSha,
        agents,
        index,
        memory: await openLocalMemoryStore(local.root),
        signal: extra.signal,
        onAgentEvent: progressReporter(extra),
      });
      return reviewResult(
        result,
        `Reviewed ${files.length} changed file(s) in ${local.root} against ${local.baseRef} (${local.baseSha.slice(0, 7)}).`,
      );
    },
  );

  server.registerTool(
    "review_pull_request",
    {
      title: "Review a GitHub pull request",
      description:
        "Run the AI review agents over a GitHub pull request at its current head. By default this is a dry " +
        "run that returns the validated findings and writes nothing. With publish: true it posts the " +
        "\"AI PR Review\" check run and inline review comments to the pull request, exactly as the GitHub " +
        "Action does (fix commits are never made). Needs GITHUB_TOKEN or a logged-in gh CLI.",
      inputSchema: {
        owner: z.string().min(1).describe("Repository owner, e.g. \"sunnyeyles\"."),
        repo: z.string().min(1).describe("Repository name, e.g. \"pr-review-agents\"."),
        number: z.number().int().positive().describe("Pull request number."),
        agents: agentsSchema,
        publish: z
          .boolean()
          .optional()
          .describe("Post the check run and review comments to GitHub. Defaults to false."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ owner, repo, number, agents, publish = false }, extra) => {
      const client = environment.createTokenClient({ token: await resolveGithubToken(environment) });
      const ref = { owner, repo, pullRequestNumber: number };
      const pullRequest = await client.getPullRequest(ref);
      const result = await runReview(environment, {
        client,
        target: { ...ref, headSha: pullRequest.headSha },
        baseSha: pullRequest.baseSha,
        agents,
        ...(publish ? { publishTo: client } : {}),
        signal: extra.signal,
        onAgentEvent: progressReporter(extra),
      });
      const where = `${owner}/${repo}#${number} at ${pullRequest.headSha.slice(0, 7)}`;
      return reviewResult(
        result,
        publish ? `Reviewed and published to ${where}.` : `Dry-run review of ${where}; nothing was posted.`,
      );
    },
  );
}
