import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { renderRepository } from "@pr-review/ai";
import { referencesTo, type RepositoryIndex } from "@pr-review/index";
import { z } from "zod";

import type { McpEnvironment } from "#src/environment";
import type { LocalIndex } from "#src/local-index";

const MAX_REFERENCES = 100;

const repoPathSchema = z
  .string()
  .optional()
  .describe("Path to the git checkout; defaults to the server's working directory.");

const filePathSchema = z
  .string()
  .min(1)
  .describe('Repository-relative path, e.g. "packages/index/src/references.ts".');

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function indexHeader(index: RepositoryIndex) {
  return { files: index.files.size, truncated: index.truncated };
}

function unknownPath(index: RepositoryIndex, file: string): CallToolResult {
  return json({
    index: indexHeader(index),
    path: file,
    known: false,
    reason: "not in the index: the path does not exist, is ignored by git, or sits in a skipped directory",
  });
}

export function registerIndexTools(
  server: McpServer,
  environment: McpEnvironment,
  loadIndex: (repoPath: string) => Promise<LocalIndex>,
): void {
  const load = (repoPath: string | undefined) =>
    loadIndex(path.resolve(environment.cwd, repoPath ?? "."));

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
      description:
        "List the files that import one file, from parsed import statements rather than a text search. " +
        "With `name`, only files importing that exported name; namespace imports are always included. " +
        `At most ${MAX_REFERENCES} files are returned; \`total\` is the true count. An empty list means ` +
        "nothing imports the path only when the index is not truncated.",
      inputSchema: {
        path: filePathSchema,
        name: z.string().min(1).optional().describe('One exported name, e.g. "referencesTo".'),
        repoPath: repoPathSchema,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path: file, name, repoPath }) => {
      const { index } = await load(repoPath);
      if (!index.files.has(file)) {
        return unknownPath(index, file);
      }
      const references = referencesTo(index.importers, file, name);
      return json({
        index: indexHeader(index),
        path: file,
        ...(name === undefined ? {} : { name }),
        known: true,
        total: references.length,
        references: references.slice(0, MAX_REFERENCES),
      });
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
        return unknownPath(index, file);
      }
      const imports = index.edges
        .filter((edge) => edge.from === file)
        .map(({ specifier, to, line }) => ({ line, specifier, resolved: to ?? null }));
      return json({ index: indexHeader(index), known: true, ...described, imports });
    },
  );
}
