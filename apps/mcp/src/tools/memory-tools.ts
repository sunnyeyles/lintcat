import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  addSuppression,
  readMemory,
  titleShape,
  writeMemory,
} from "@pr-review/reviewer";
import { z } from "zod";

import { checkoutRoot } from "#src/checkout-path";
import type { ConnectedClient } from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";
import { openLocalMemoryStore } from "#src/local-memory-store";
import { repoPathSchema } from "#src/tools/shared";

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
          .describe('The finding\'s category, as the review reported it, e.g. "security".'),
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
      const store = await openLocalMemoryStore(root);
      const memory = await readMemory(store, environment.logger);
      const updated = addSuppression(
        memory,
        { category, title, ...(reason === undefined ? {} : { reason }) },
        new Date(),
      );
      await writeMemory(store, updated);
      environment.logger.info("memory.suppression_recorded", {
        repoPath: root,
        category,
        shape: titleShape(title),
      });
      return {
        content: [
          {
            type: "text",
            text:
              `Suppressed ${category} findings shaped like "${titleShape(title)}" in ${root}. ` +
              `${updated.suppressions.length} suppression(s) now live in ${store.path}.`,
          },
          { type: "text", text: JSON.stringify(updated.suppressions, null, 2) },
        ],
      };
    },
  );
}
