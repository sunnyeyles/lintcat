import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SetLevelRequestSchema, type LoggingLevel } from "@modelcontextprotocol/sdk/types.js";
import type { StructuredLogger } from "@pr-review/logging";

import type { ConnectedClient } from "#src/client-capabilities";

/** Names this server as the source of the line in the client's interface. */
const LOGGER_NAME = "pr-review-agents";

/** The spec's levels, quietest first; an index into this is a severity. */
const LEVELS: readonly LoggingLevel[] = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
];

/** What a client that has never named a level is sent. */
const DEFAULT_LEVEL: LoggingLevel = "info";

function atLeast(level: LoggingLevel, threshold: LoggingLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(threshold);
}

/**
 * Log lines as `notifications/message`, or stderr for a client that takes none.
 * `logging` is a server capability, so asking for a level is the only sign it does.
 */
export function createClientLogger(
  server: McpServer,
  client: ConnectedClient,
  fallback: StructuredLogger,
): StructuredLogger {
  let requested: LoggingLevel | undefined;
  // Replaces the SDK's own handler, so the filtering below is the only one left.
  server.server.setRequestHandler(SetLevelRequestSchema, (request) => {
    requested = request.params.level;
    return {};
  });

  const emit = (level: "info" | "error", event: string, fields: Record<string, unknown>): void => {
    if (!client.features().logging && requested === undefined) {
      fallback[level](event, fields);
      return;
    }
    if (!atLeast(level, requested ?? DEFAULT_LEVEL)) {
      return;
    }
    void server.server
      .sendLoggingMessage({ level, logger: LOGGER_NAME, data: { event, ...fields } })
      .catch(() => fallback[level](event, fields));
  };

  return {
    info: (event, fields = {}) => emit("info", event, fields),
    error: (event, fields = {}) => emit("error", event, fields),
  };
}
