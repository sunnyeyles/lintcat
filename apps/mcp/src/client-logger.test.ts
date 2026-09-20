import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  LoggingMessageNotificationSchema,
  type LoggingMessageNotification,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createCapturingLogger,
  createStderrLogger,
  type CapturedLogEvent,
  type StructuredLogger,
} from "@pr-review/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectedClient, staticClient, type ConnectedClient } from "#src/client-capabilities";
import { createClientLogger } from "#src/client-logger";
import type { McpEnvironment } from "#src/environment";
import { createServer } from "#src/server";
import { createTestRepo, type TestRepo } from "#src/test-repo";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo({ "package.json": '{ "name": "fixture" }\n' });
});

afterEach(() => {
  repo.remove();
  vi.restoreAllMocks();
});

function environment(logger: McpEnvironment["logger"]): McpEnvironment {
  return {
    env: {},
    cwd: repo.root,
    logger,
    createLanguageModel: () => {
      throw new Error("no model scripted");
    },
    createTokenClient: () => {
      throw new Error("no GitHub client scripted");
    },
    gh: async () => {
      throw new Error("no gh scripted");
    },
    database: () => {
      throw new Error("no database scripted");
    },
  };
}

interface Harness {
  client: Client;
  logger: StructuredLogger;
  /** Every `notifications/message` the client received, in order. */
  notifications: LoggingMessageNotification["params"][];
  /** What fell back to the process logger instead. */
  entries: CapturedLogEvent[];
}

/** Connects a real client to a bare server carrying only the logger under test. */
async function harness(options: {
  client?: ConnectedClient;
  fallback?: StructuredLogger;
} = {}): Promise<Harness> {
  const capturing = createCapturingLogger();
  const fallback = options.fallback ?? capturing.logger;
  const server = new McpServer({ name: "test-server", version: "0.0.0" }, { capabilities: { logging: {} } });
  const logger = createClientLogger(server, options.client ?? connectedClient(server), fallback);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  const notifications: LoggingMessageNotification["params"][] = [];
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    notifications.push(notification.params);
  });
  await client.connect(clientTransport);
  return { client, logger, notifications, entries: capturing.entries };
}

/** Lets the in-memory transport deliver anything already sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a client that takes log messages", () => {
  it("sends the event and its fields as a logging notification", async () => {
    const { client, logger, notifications } = await harness();
    await client.setLoggingLevel("info");

    logger.info("review.started", { repository: "octo-org/example-service" });

    await vi.waitFor(() =>
      expect(notifications).toEqual([
        {
          level: "info",
          logger: "pr-review-agents",
          data: { event: "review.started", repository: "octo-org/example-service" },
        },
      ]),
    );
  });

  it("leaves the process's own logger silent", async () => {
    const { client, logger, notifications, entries } = await harness();
    await client.setLoggingLevel("info");

    logger.error("review.failed", { error: "boom" });

    await vi.waitFor(() => expect(notifications.length).toBe(1));
    expect(entries).toEqual([]);
  });

  it("believes an injected client without waiting for it to ask", async () => {
    const { logger, notifications } = await harness({ client: staticClient({ logging: true }) });

    logger.info("review.started");

    await vi.waitFor(() => expect(notifications.map((params) => params.level)).toEqual(["info"]));
  });
});

describe("the level the client asked for", () => {
  it("drops a line quieter than it", async () => {
    const { client, logger, notifications } = await harness();
    await client.setLoggingLevel("error");

    logger.info("review.started");
    logger.error("review.failed", { error: "boom" });

    await settle();
    expect(notifications).toEqual([
      { level: "error", logger: "pr-review-agents", data: { event: "review.failed", error: "boom" } },
    ]);
  });

  it("drops nothing when the client asks for debug", async () => {
    const { client, logger, notifications } = await harness();
    await client.setLoggingLevel("debug");

    logger.info("review.started");
    logger.error("review.failed");

    await vi.waitFor(() => expect(notifications.map((params) => params.level)).toEqual(["info", "error"]));
  });

  it("widens again when the client lowers it", async () => {
    const { client, logger, notifications } = await harness();
    await client.setLoggingLevel("error");
    await client.setLoggingLevel("info");

    logger.info("review.started");

    await vi.waitFor(() => expect(notifications.map((params) => params.level)).toEqual(["info"]));
  });

  it("sends both levels to an injected client that never asked", async () => {
    const { logger, notifications } = await harness({ client: staticClient({ logging: true }) });

    logger.info("review.started");
    logger.error("review.failed");

    await vi.waitFor(() => expect(notifications.map((params) => params.level)).toEqual(["info", "error"]));
  });
});

describe("a client that takes none", () => {
  it("falls back to the process logger", async () => {
    const { logger, notifications, entries } = await harness();

    logger.info("review.started", { repository: "octo-org/example-service" });

    await settle();
    expect(notifications).toEqual([]);
    expect(entries).toEqual([
      { level: "info", event: "review.started", repository: "octo-org/example-service" },
    ]);
  });

  it("keeps stdout clear, writing the fallback line to stderr", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = await harness({ fallback: createStderrLogger() });

    logger.info("review.started");

    expect(log).not.toHaveBeenCalled();
    expect(JSON.parse(error.mock.calls.at(-1)?.[0] as string)).toMatchObject({ event: "review.started" });
  });
});

describe("a send that cannot reach the client", () => {
  it("falls back to the process logger", async () => {
    const { logger: fallback, entries } = createCapturingLogger();
    const server = new McpServer({ name: "test-server", version: "0.0.0" }, { capabilities: { logging: {} } });
    const logger = createClientLogger(server, staticClient({ logging: true }), fallback);

    logger.error("review.failed", { error: "boom" });

    await vi.waitFor(() =>
      expect(entries).toEqual([{ level: "error", event: "review.failed", error: "boom" }]),
    );
  });
});

describe("the server's own logging", () => {
  async function connectToServer(client?: ConnectedClient) {
    const { logger, entries } = createCapturingLogger();
    const server = createServer(environment(logger), client ? { client } : {});
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const connected = new Client({ name: "test", version: "0.0.0" });
    const notifications: LoggingMessageNotification["params"][] = [];
    connected.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      notifications.push(notification.params);
    });
    await connected.connect(clientTransport);
    return { client: connected, notifications, entries };
  }

  it("declares the logging capability so a client may set a level", async () => {
    const { client } = await connectToServer();

    expect(client.getServerCapabilities()?.logging).toEqual({});
    await expect(client.setLoggingLevel("warning")).resolves.toEqual({});
  });

  it("routes the tools' logger to a client that takes log messages", async () => {
    const { notifications } = await connectToServer(staticClient({ logging: true }));

    await vi.waitFor(() =>
      expect(notifications).toContainEqual(
        expect.objectContaining({ data: expect.objectContaining({ event: "mcp.client" }) }),
      ),
    );
  });

  it("routes it to stderr for a client that takes none", async () => {
    const { notifications, entries } = await connectToServer();

    await vi.waitFor(() =>
      expect(entries).toContainEqual(expect.objectContaining({ event: "mcp.client" })),
    );
    expect(notifications).toEqual([]);
  });
});
