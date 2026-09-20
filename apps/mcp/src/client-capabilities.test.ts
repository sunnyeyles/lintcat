import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { createCapturingLogger, type CapturedLogEvent } from "@pr-review/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NO_CLIENT_FEATURES,
  readClientFeatures,
  staticClient,
  type ClientFeatures,
} from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";
import { createServer } from "#src/server";
import { createTestRepo, type TestRepo } from "#src/test-repo";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo({ "package.json": '{ "name": "fixture" }\n' });
});

afterEach(() => repo.remove());

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

/** Connects a real client advertising `capabilities` and returns what the server saw. */
async function negotiated(capabilities: ClientCapabilities): Promise<CapturedLogEvent> {
  const { logger, entries } = createCapturingLogger();
  const server = createServer(environment(logger));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities });
  await client.connect(clientTransport);
  return entries.find((entry) => entry.event === "mcp.client")!;
}

describe("reading a capability record", () => {
  it("reports every feature unavailable for a client advertising nothing", () => {
    expect(readClientFeatures({})).toEqual(NO_CLIENT_FEATURES);
  });

  it("reports every feature unavailable before initialize", () => {
    expect(readClientFeatures(undefined)).toEqual(NO_CLIENT_FEATURES);
  });

  it("reads sampling, roots and logging from an advertising client", () => {
    const advertised = { sampling: {}, roots: { listChanged: true }, logging: {} } as ClientCapabilities;

    expect(readClientFeatures(advertised)).toEqual({
      sampling: true,
      roots: true,
      rootsListChanged: true,
      logging: true,
    } satisfies ClientFeatures);
  });

  it("keeps roots without listChanged apart from roots with it", () => {
    expect(readClientFeatures({ roots: {} })).toMatchObject({ roots: true, rootsListChanged: false });
  });

  it("ignores capabilities it does not speak for", () => {
    expect(readClientFeatures({ elicitation: {}, experimental: { custom: {} } })).toEqual(NO_CLIENT_FEATURES);
  });
});

describe("the fake", () => {
  it("defaults to a client that can do nothing", () => {
    expect(staticClient().features()).toEqual(NO_CLIENT_FEATURES);
  });

  it("names only the features it was given", () => {
    expect(staticClient({ sampling: true }).features()).toMatchObject({ sampling: true, roots: false });
  });
});

describe("the live connection", () => {
  it("sees a sampling client's features", async () => {
    const seen = await negotiated({ sampling: {}, roots: { listChanged: true } });

    expect(seen).toMatchObject({ sampling: true, roots: true, rootsListChanged: true, logging: false });
  });

  it("sees nothing for a client that samples nothing", async () => {
    const seen = await negotiated({});

    expect(seen).toMatchObject(NO_CLIENT_FEATURES);
  });

  it("takes an injected client over the live one", async () => {
    const { logger, entries } = createCapturingLogger();
    const server = createServer(environment(logger), { client: staticClient({ sampling: true }) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await new Client({ name: "test", version: "0.0.0" }, { capabilities: {} }).connect(clientTransport);

    expect(entries.find((entry) => entry.event === "mcp.client")).toMatchObject({ sampling: true });
  });
});
