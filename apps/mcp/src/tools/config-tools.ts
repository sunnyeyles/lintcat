import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_AGENT_CONFIG_PATH } from "@pr-review/ai";
import { z } from "zod";

import { describeAgentConfig } from "#src/agent-config";
import type { McpEnvironment } from "#src/environment";

function result(heading: string, body: unknown): CallToolResult {
  return {
    content: [
      { type: "text", text: heading },
      { type: "text", text: JSON.stringify(body, null, 2) },
    ],
  };
}

export function registerConfigTools(server: McpServer, environment: McpEnvironment): void {
  server.registerTool(
    "validate_agent_config",
    {
      title: "Validate the agent configuration",
      description:
        `Parse and validate a local checkout's agent configuration (${DEFAULT_AGENT_CONFIG_PATH}) and report ` +
        "what it resolves to: the agents that would run, with any model and path overrides. Parse and schema " +
        "errors are reported with the line and entry that caused them. A checkout with no configuration file " +
        "is valid and runs the default general agent. No model calls, no network, no API key needed.",
      inputSchema: {
        repoPath: z
          .string()
          .optional()
          .describe("Path to the git checkout; defaults to the server's working directory."),
        configPath: z
          .string()
          .optional()
          .describe(`Repository-relative path to the configuration; defaults to ${DEFAULT_AGENT_CONFIG_PATH}.`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ repoPath, configPath }) => {
      const root = path.resolve(environment.cwd, repoPath ?? ".");
      const { heading, report } = await describeAgentConfig(root, configPath ?? DEFAULT_AGENT_CONFIG_PATH);
      return result(heading, report);
    },
  );
}
