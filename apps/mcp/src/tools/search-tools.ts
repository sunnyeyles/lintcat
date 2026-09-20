import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { McpEnvironment } from "#src/environment";
import { openLocalRepository, searchWorkingTree } from "#src/local-git-client";

const MAX_MATCHES = 200;

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function registerSearchTools(server: McpServer, environment: McpEnvironment): void {
  server.registerTool(
    "search_code",
    {
      title: "Search code",
      description:
        "Text-search a local checkout, returning one entry per matching line with its path and line " +
        "number. Matching is case-insensitive and literal, never a regular expression; several " +
        "whitespace-separated terms keep only the lines containing all of them. Binary files are " +
        "skipped, git-ignored ones are not searched, and the working tree is read as it is on disk. " +
        `At most ${MAX_MATCHES} lines are returned; \`total\` is the true count.`,
      inputSchema: {
        query: z.string().min(1).describe('Literal text to find, e.g. "createSession".'),
        path: z
          .string()
          .min(1)
          .optional()
          .describe('Limit to one repository-relative file or directory, e.g. "packages/index/src".'),
        repoPath: z
          .string()
          .optional()
          .describe("Path to the git checkout; defaults to the server's working directory."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, path: scope, repoPath }) => {
      const { root } = await openLocalRepository(path.resolve(environment.cwd, repoPath ?? "."), "HEAD");
      const hits = await searchWorkingTree(root, query, scope);
      return json({
        root,
        query,
        ...(scope === undefined ? {} : { path: scope }),
        total: hits.length,
        truncated: hits.length > MAX_MATCHES,
        matches: hits.slice(0, MAX_MATCHES),
      });
    },
  );
}
