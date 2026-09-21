/** v2 agent configuration fails a review rather than being silently ignored. */
import { access } from "node:fs/promises";
import path from "node:path";

export const LEGACY_AGENT_CONFIG_PATH = ".github/pr-review-agents.yml";

function removedInV3(what: string, fix: string): string {
  return (
    `${what} was removed in v3: every review now runs the single general reviewer, ` +
    `so it would be ignored. ${fix}`
  );
}

export const REMOVED_AGENTS_ARGUMENT = removedInV3(
  "The `agents` argument",
  "Call the tool without it.",
);

export const REMOVED_AGENTS_FLAG = removedInV3("--agents", "Drop the flag.");

export class LegacyAgentConfigError extends Error {
  constructor() {
    super(
      removedInV3(
        `\`${LEGACY_AGENT_CONFIG_PATH}\``,
        "Delete the file from the checkout; nothing reads it.",
      ),
    );
    this.name = "LegacyAgentConfigError";
  }
}

/** Throws when the checkout's working tree still holds the v2 config file. */
export async function rejectLegacyAgentConfig(root: string): Promise<void> {
  const present = await access(path.join(root, LEGACY_AGENT_CONFIG_PATH)).then(
    () => true,
    () => false,
  );
  if (present) {
    throw new LegacyAgentConfigError();
  }
}
