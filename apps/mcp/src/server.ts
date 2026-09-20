import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { connectedClient, type ConnectedClient } from "#src/client-capabilities";
import { resolveGithubToken, type McpEnvironment } from "#src/environment";
import { createLocalIndexCache, type LocalIndex } from "#src/local-index";
import { registerWorkflowPrompts } from "#src/prompts/workflow-prompts";
import { registerConfigTools } from "#src/tools/config-tools";
import { registerHistoryTools } from "#src/tools/history-tools";
import { registerIndexTools } from "#src/tools/index-tools";
import { registerReviewTools } from "#src/tools/review-tools";
import { registerSearchTools } from "#src/tools/search-tools";

const INSTRUCTIONS = `Tools for the pr-review-agents code reviewer.
- list_review_agents: which agents a local checkout configures, their path gates, and which the current changes would wake. Fast; no model calls.
- review_local_changes: review the working tree before pushing. Slow (model calls); read-only.
- review_pull_request: dry-run review of a GitHub PR; publish: true posts to GitHub, so only set it when the user asks.
- repository_overview / find_references / describe_file: import-graph navigation of a local checkout; no network.
- search_code: literal text search of a local checkout, with path and line number; no network.
- validate_agent_config: check a checkout's .github/pr-review-agents.yml and see what it resolves to; no model calls.
- list_reviews / get_review / review_trends: stored review history, scoped to the user's GitHub account.

Prompts for the workflows these tools serve: review_branch (review this branch before pushing),
triage_finding (is one stored finding worth fixing), review_history (what the stored reviews show over time).`;

export interface ServerOptions {
  loadIndex?: (repoPath: string) => Promise<LocalIndex>;
  githubId?: () => Promise<number>;
  /** What the connected client can do; defaults to asking the live connection. */
  client?: ConnectedClient;
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

export function createServer(environment: McpEnvironment, options: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: "pr-review-agents", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  const client = options.client ?? connectedClient(server);
  server.server.oninitialized = () => environment.logger.info("mcp.client", { ...client.features() });
  registerReviewTools(server, environment, client);
  registerIndexTools(server, environment, client, options.loadIndex ?? createLocalIndexCache());
  registerSearchTools(server, environment, client);
  registerConfigTools(server, environment, client);
  registerHistoryTools(server, environment, options.githubId ?? githubUserId(environment));
  registerWorkflowPrompts(server);
  return server;
}
