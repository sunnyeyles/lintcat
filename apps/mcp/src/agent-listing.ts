import {
  DEFAULT_AGENT_CONFIG_PATH,
  gateAgentsByPaths,
  loadAgentDefinitions,
} from "@pr-review/ai";
import { readAtCommit } from "@pr-review/reviewer";

import type { LocalRepository } from "#src/local-git-client";

/** One configured agent and whether the working tree's changes reach it. */
interface ListedAgent {
  category: string;
  role: string;
  /** The agent's own model override, or null for the run's default. */
  model: string | null;
  /** The globs gating the agent, or null when nothing gates it. */
  paths: readonly string[] | null;
  wakes: boolean;
  reason: string;
}

export interface AgentListing {
  repository: string;
  baseRef: string;
  baseSha: string;
  configPath: string;
  /** False when no config file exists, so these are the defaults. */
  configured: boolean;
  changedFiles: string[];
  agents: ListedAgent[];
}

function reason(
  paths: readonly string[] | null,
  wakes: boolean,
  changedFiles: readonly string[],
): string {
  if (paths === null) {
    return "no path gate, so it runs on every review";
  }
  if (wakes) {
    return "a changed file matches its paths";
  }
  return changedFiles.length === 0
    ? "nothing has changed yet"
    : "no changed file matches its paths";
}

/**
 * The agents a local review would run. Configuration is read at the base
 * commit, as a review does, so an uncommitted config is not yet in effect.
 */
export async function listAgents(local: LocalRepository): Promise<AgentListing> {
  const { client, target, baseSha } = local;
  const source = await readAtCommit(client, target, baseSha)(DEFAULT_AGENT_CONFIG_PATH);
  const definitions = await loadAgentDefinitions({ readFile: async () => source });

  const changedFiles = (await client.listChangedFiles(target)).map((file) => file.filename);
  const woken = new Set(
    gateAgentsByPaths(definitions, changedFiles).active.map((agent) => agent.category),
  );

  const agents = definitions.map((definition): ListedAgent => {
    const paths = definition.paths ?? null;
    const wakes = woken.has(definition.category);
    return {
      category: definition.category,
      role: definition.role,
      model: definition.model ?? null,
      paths,
      wakes,
      reason: reason(paths, wakes, changedFiles),
    };
  });

  return {
    repository: local.root,
    baseRef: local.baseRef,
    baseSha,
    configPath: DEFAULT_AGENT_CONFIG_PATH,
    configured: source !== undefined,
    changedFiles,
    agents,
  };
}
