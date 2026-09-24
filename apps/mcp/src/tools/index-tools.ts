import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { renderRepository } from "@pr-review/ai";
import {
  findReferences,
  findReferencesDescription,
  indexHeader,
  renderFindReferences,
  unknownPath,
  type RepositoryIndex,
} from "@pr-review/index";
import { z } from "zod";

import { resolveCheckoutPath } from "#src/checkout-path";
import type { ConnectedClient } from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";
import type { LocalIndex } from "#src/local-index";
import { json, repoPathSchema } from "#src/tools/shared";

const filePathSchema = z
  .string()
  .min(1)
  .describe('Repository-relative path, e.g. "packages/index/src/references.ts".');

function unknown(index: RepositoryIndex, file: string): CallToolResult {
  return json(unknownPath(index, file));
}

export function registerIndexTools(
  server: McpServer,
  environment: McpEnvironment,
  client: ConnectedClient,
  loadIndex: (repoPath: string) => Promise<LocalIndex>,
): void {
  const load = async (repoPath: string | undefined) =>
    loadIndex(await resolveCheckoutPath(environment, client, repoPath));

  server.registerTool(
    "repository_overview",
    {
      title: "Repository overview",
      description:
        "Summarise a local checkout from its import index: the workspace packages and, per language, how " +
        "many files were read and how many internal imports resolved. Reflects the working tree, " +
        "uncommitted files included.",
      inputSchema: { repoPath: repoPathSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ repoPath }) => {
      const { root, index } = await load(repoPath);
      return {
        content: [{ type: "text", text: [`Checkout: ${root}`, ...renderRepository(index)].join("\n") }],
      };
    },
  );

  server.registerTool(
    "find_references",
    {
      title: "Find references",
      description: findReferencesDescription(
        "the index of the local checkout's working tree, uncommitted files included",
      ),
      inputSchema: {
        path: filePathSchema,
        name: z.string().min(1).optional().describe('One exported name, e.g. "referencesTo".'),
        repoPath: repoPathSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: file, name, repoPath }) => {
      const { index } = await load(repoPath);
      return {
        content: [
          { type: "text", text: renderFindReferences(findReferences(index, { path: file, name })) },
        ],
      };
    },
  );

  server.registerTool(
    "describe_file",
    {
      title: "Describe file",
      description:
        "What the import index knows about one file: its role (source, test, config…), language, owning " +
        "package, how many files import it, the test that covers it (or the source a test covers), and " +
        "the imports it makes.",
      inputSchema: { path: filePathSchema, repoPath: repoPathSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: file, repoPath }) => {
      const { index } = await load(repoPath);
      const described = index.files.get(file);
      if (described === undefined) {
        return unknown(index, file);
      }
      const imports = index.edges
        .filter((edge) => edge.from === file)
        .map(({ specifier, to, line }) => ({ line, specifier, resolved: to ?? null }));
      return json({ index: indexHeader(index), known: true, ...described, imports });
    },
  );
}
