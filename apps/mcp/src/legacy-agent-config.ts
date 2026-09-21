/** v2 agent configuration fails a review rather than being silently ignored. */
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
