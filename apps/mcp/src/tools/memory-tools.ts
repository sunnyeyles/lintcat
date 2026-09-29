import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { resolveCheckoutPath } from "#src/checkout-path";
import type { ConnectedClient } from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";
import { repositoryRoot } from "#src/local-git-client";
import { recordSuppression } from "#src/local-memory-store";
import { repoPathSchema } from "#src/tools/shared";

/** No base branch is resolved here: suppressing needs the checkout, not a diff. */
async function checkoutRoot(
  environment: McpEnvironment,
  client: ConnectedClient,
  repoPath: string | undefined,
): Promise<string> {
  const from = await resolveCheckoutPath(environment, client, repoPath);
  return repositoryRoot(from);
}

export function registerMemoryTools(
  server: McpServer,
  environment: McpEnvironment,
  client: ConnectedClient,
): void {
  server.registerTool(
    "suppress_finding",
    {
      title: "Suppress a review finding",
      description:
        "Mark one finding as a false positive so later reviews of this checkout stop raising it. The " +
        "suppression is stored with the checkout's review memory and matched by the finding's category " +
        "and title shape, so the same finding in another file is suppressed too. review_local_changes " +
        "then excludes those findings and reports how many it hid. Writes one local file; no network.",
      inputSchema: {
        repoPath: repoPathSchema,
        category: z
          .string()
          .min(1)
          .describe('The finding\'s category, as the review reported it, e.g. "naming".'),
        title: z
          .string()
          .min(1)
          .describe("The finding's title, copied from the review; identifiers in it are ignored when matching."),
        reason: z
          .string()
          .min(1)
          .optional()
          .describe("Why this finding is noise here; kept for whoever reads the memory later."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ repoPath, category, title, reason }): Promise<CallToolResult> => {
      const root = await checkoutRoot(environment, client, repoPath);
      const recorded = await recordSuppression(
        root,
        { category, title, ...(reason === undefined ? {} : { reason }) },
        environment.logger,
      );
      return {
        content: [
          {
            type: "text",
            text:
              `Suppressed ${category} findings shaped like "${recorded.shape}" in ${root}. ` +
              `${recorded.suppressions.length} suppression(s) now live in ${recorded.path}.`,
          },
          { type: "text", text: JSON.stringify(recorded.suppressions, null, 2) },
        ],
      };
    },
  );
}
