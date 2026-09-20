import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadAgentDefinitions, type AgentDefinition } from "@pr-review/ai";

interface Location {
  line: number;
  column: number;
}

export interface AgentConfigReport {
  checkout: string;
  path: string;
  present: boolean;
  valid: boolean;
  usingDefaults: boolean;
  agents?: ReturnType<typeof summariseAgent>[];
  location?: Location;
  error?: string;
}

export interface AgentConfigDescription {
  heading: string;
  report: AgentConfigReport;
}

/** The `at line N, column M` the YAML parser appends to a syntax error. */
function locationOf(message: string): Location | undefined {
  const match = /\bat line (\d+), column (\d+)/.exec(message);
  if (match === null) {
    return undefined;
  }
  return { line: Number(match[1]), column: Number(match[2]) };
}

function summariseAgent(agent: AgentDefinition) {
  return {
    agent: agent.category,
    role: agent.role,
    ...(agent.model === undefined ? {} : { model: agent.model }),
    ...(agent.paths === undefined ? {} : { paths: [...agent.paths] }),
    ...(agent.standalone === true ? { standalone: true } : {}),
  };
}

/** Resolves a checkout's agent configuration; an invalid one is a report, not a throw. */
export async function describeAgentConfig(root: string, relative: string): Promise<AgentConfigDescription> {
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
    return {
      heading: present
        ? `${relative} is valid: ${agents.length} agent(s) would run in ${root}.`
        : `No ${relative} in ${root}; valid, using defaults.`,
      report: {
        checkout: root,
        path: relative,
        present,
        valid: true,
        usingDefaults: !present,
        agents: agents.map(summariseAgent),
      },
    };
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.name !== "AgentConfigError") {
      throw error;
    }
    const location = locationOf(error.message);
    return {
      heading: `${relative} is not usable as it stands.`,
      report: {
        checkout: root,
        path: relative,
        present,
        valid: false,
        usingDefaults: false,
        ...(location === undefined ? {} : { location }),
        error: error.message,
      },
    };
  }
}
