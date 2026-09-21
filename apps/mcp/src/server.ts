import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import { connectedClient, type ConnectedClient } from "#src/client-capabilities";
import { createClientLogger } from "#src/client-logger";
import { resolveGithubToken, type McpEnvironment } from "#src/environment";
import { createLocalIndexCache, type LocalIndex } from "#src/local-index";
import { registerWorkflowPrompts } from "#src/prompts/workflow-prompts";
import { registerContextResources } from "#src/resources/context-resources";
import { registerFixTools } from "#src/tools/fix-tools";
import { registerHistoryTools } from "#src/tools/history-tools";
import { registerIndexTools } from "#src/tools/index-tools";
import { registerMemoryTools } from "#src/tools/memory-tools";
import { registerReviewTools } from "#src/tools/review-tools";
import { registerSearchTools } from "#src/tools/search-tools";

const INSTRUCTIONS = `Tools for the pr-review-agents code reviewer.
- review_local_changes: review the working tree before pushing, or scope "staged" before committing, or an explicit commit range. Slow (model calls); read-only. With no provider key set it runs through your own model via sampling, and says the review was the reduced single-shot one.
- review_pull_request: dry-run review of a GitHub PR; publish: true posts to GitHub, so only set it when the user asks.
- apply_fix: write a verified patch from a review into the working tree. Writes files; never commits or pushes.
- suppress_finding: mark a false positive so later reviews of the same checkout stop raising it. Writes one local file.
- repository_overview / find_references / describe_file: import-graph navigation of a local checkout; no network.
- search_code: literal text search of a local checkout, with path and line number; no network.
- list_reviews / get_review / review_trends: stored review history, scoped to the user's GitHub account.

Prompts for the workflows these tools serve: review_branch (review this branch before pushing),
triage_finding (is one stored finding worth fixing), review_history (what the stored reviews show over time).

Resources to attach rather than fetch: pr-review://review/{org}/{id} (a stored review, as
list_reviews links it), pr-review://file/{path} (a file of this checkout, read from the working tree).`;

export interface ServerOptions {
  loadIndex?: (repoPath: string) => Promise<LocalIndex>;
  githubId?: () => Promise<number>;
  /** What the connected client can do; defaults to asking the live connection. */
  client?: ConnectedClient;
  /** Hides and refuses every tool not annotated read-only; defaults to PR_REVIEW_MCP_READ_ONLY. */
  readOnly?: boolean;
}

function readOnlyFromEnv(env: McpEnvironment["env"]): boolean {
  return ["1", "true"].includes(env["PR_REVIEW_MCP_READ_ONLY"]?.trim().toLowerCase() ?? "");
}

/** Disables each write tool as it registers, so later tools are covered without per-tool code. */
function hideWriteTools(server: McpServer): void {
  const register = server.registerTool.bind(server) as (...args: unknown[]) => RegisteredTool;
  (server as { registerTool: unknown }).registerTool = (...args: unknown[]) => {
    const tool = register(...args);
    const config = args[1] as { annotations?: ToolAnnotations };
    if (config.annotations?.readOnlyHint !== true) tool.disable();
    return tool;
  };
}

/** The signed-in user's numeric GitHub id, read once per server. */
function githubUserId(environment: McpEnvironment): () => Promise<number> {
  let id: Promise<number> | undefined;
  return () => {
    id ??= (async () => {
      const token = await resolveGithubToken(environment);
      const response = await fetch("https://api.github.com/user", {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      });
      if (!response.ok) {
        throw new Error(`GitHub rejected the token when asked who you are (HTTP ${response.status}).`);
      }
      return ((await response.json()) as { id: number }).id;
    })();
    id.catch(() => {
      id = undefined;
    });
    return id;
  };
}

export function createServer(base: McpEnvironment, options: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "pr-review-agents", version: "0.1.0" },
    { instructions: INSTRUCTIONS, capabilities: { logging: {} } },
  );
  if (options.readOnly ?? readOnlyFromEnv(base.env)) hideWriteTools(server);
  const client = options.client ?? connectedClient(server);
  const environment: McpEnvironment = {
    ...base,
    logger: createClientLogger(server, client, base.logger),
  };
  server.server.oninitialized = () => environment.logger.info("mcp.client", { ...client.features() });
  registerReviewTools(server, environment, client);
  registerFixTools(server, environment, client);
  registerIndexTools(server, environment, client, options.loadIndex ?? createLocalIndexCache());
  registerSearchTools(server, environment, client);
  registerMemoryTools(server, environment, client);
  const githubId = options.githubId ?? githubUserId(environment);
  registerHistoryTools(server, environment, githubId);
  registerContextResources(server, environment, githubId);
  registerWorkflowPrompts(server);
  return server;
}
