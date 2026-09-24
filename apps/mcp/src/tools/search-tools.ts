import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveCheckoutPath } from "#src/checkout-path";
import type { ConnectedClient } from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";
import { repositoryRoot, searchWorkingTree } from "#src/local-git-client";
import { json, repoPathSchema } from "#src/tools/shared";

/** Lines, not files, so `SEARCH_LIMITS.maxMatches` is a cap on a different thing. */
const MAX_LINES = 200;

export function registerSearchTools(
  server: McpServer,
  environment: McpEnvironment,
  client: ConnectedClient,
): void {
  server.registerTool(
    "search_code",
    {
      title: "Search code",
      description:
        "Text-search a local checkout, returning one entry per matching line with its path and line " +
        "number, where the repository search tools return a file with snippets. Query grammar and " +
        "matching are the repository search's. Binary files are skipped, git-ignored ones are not " +
        "searched, and the working tree is read as it is on disk. " +
        `At most ${MAX_LINES} lines are returned; \`total\` is the true count.`,
      inputSchema: {
        query: z.string().min(1).describe('Literal text to find, e.g. "createSession".'),
        path: z
          .string()
          .min(1)
          .optional()
          .describe('Limit to one repository-relative file or directory, e.g. "packages/index/src".'),
        repoPath: repoPathSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, path: scope, repoPath }) => {
      const checkout = await resolveCheckoutPath(environment, client, repoPath);
      const root = await repositoryRoot(checkout);
      const hits = await searchWorkingTree(root, query, scope);
      return json({
        root,
        query,
        ...(scope === undefined ? {} : { path: scope }),
        total: hits.length,
        truncated: hits.length > MAX_LINES,
        matches: hits.slice(0, MAX_LINES),
      });
    },
  );
}
