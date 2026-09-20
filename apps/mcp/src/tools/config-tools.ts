import { readFile } from "node:fs/promises";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DEFAULT_AGENT_CONFIG_PATH, loadAgentDefinitions, type AgentDefinition } from "@pr-review/ai";
import { z } from "zod";

import { resolveCheckoutPath } from "#src/checkout-path";
import type { ConnectedClient } from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";

interface Location {
  line: number;
  column: number;
}

/** The `at line N, column M` the YAML parser appends to a syntax error. */
function locationOf(message: string): Location | undefined {
  const match = /\bat line (\d+), column (\d+)/.exec(message);
  if (match === null) {
    return undefined;
  }
  return { line: Number(match[1]), column: Number(match[2]) };
}

function summarise(agent: AgentDefinition) {
  return {
    agent: agent.category,
    role: agent.role,
    ...(agent.model === undefined ? {} : { model: agent.model }),
    ...(agent.paths === undefined ? {} : { paths: [...agent.paths] }),
    ...(agent.standalone === true ? { standalone: true } : {}),
  };
}

function result(heading: string, body: unknown): CallToolResult {
  return {
    content: [
      { type: "text", text: heading },
      { type: "text", text: JSON.stringify(body, null, 2) },
    ],
  };
}

export function registerConfigTools(
  server: McpServer,
  environment: McpEnvironment,
  client: ConnectedClient,
): void {
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
      const root = await resolveCheckoutPath(environment, client, repoPath);
      const relative = configPath ?? DEFAULT_AGENT_CONFIG_PATH;
      let present = false;

      try {
        const agents = await loadAgentDefinitions({
          path: relative,
          readFile: async (file) => {
            try {
              const source = await readFile(path.resolve(root, file), "utf8");
              present = true;
              return source;
            } catch (error: unknown) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return undefined;
              }
              throw error;
            }
          },
        });
        const heading = present
          ? `${relative} is valid: ${agents.length} agent(s) would run in ${root}.`
          : `No ${relative} in ${root}; valid, using defaults.`;
        return result(heading, {
          checkout: root,
          path: relative,
          present,
          valid: true,
          usingDefaults: !present,
          agents: agents.map(summarise),
        });
      } catch (error: unknown) {
        if (!(error instanceof Error) || error.name !== "AgentConfigError") {
          throw error;
        }
        const location = locationOf(error.message);
        return result(`${relative} is not usable as it stands.`, {
          checkout: root,
          path: relative,
          present,
          valid: false,
          usingDefaults: false,
          ...(location === undefined ? {} : { location }),
          error: error.message,
        });
      }
    },
  );
}
