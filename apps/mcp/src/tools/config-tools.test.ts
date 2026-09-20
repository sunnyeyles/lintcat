import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createCapturingLogger } from "@pr-review/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { McpEnvironment } from "#src/environment";
import { createServer } from "#src/server";
import { createTestRepo, type TestRepo } from "#src/test-repo";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo({ "package.json": '{ "name": "fixture" }\n' });
});

afterEach(() => repo.remove());

/** No model key and no GitHub client: the tool must need neither. */
function environment(): McpEnvironment {
  return {
    env: {},
    cwd: repo.root,
    logger: createCapturingLogger().logger,
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

async function validate(args: Record<string, unknown> = {}) {
  const server = createServer(environment());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);

  const result = (await client.callTool({
    name: "validate_agent_config",
    arguments: args,
  })) as CallToolResult;
  const texts = result.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
  return { isError: result.isError === true, heading: texts[0]!, body: JSON.parse(texts[1]!) };
}

describe("validate_agent_config", () => {
  it("summarises the agents a valid configuration resolves to", async () => {
    repo.write(
      ".github/pr-review-agents.yml",
      "agents:\n  - security\n  - agent: test-coverage\n    model: gpt-5\n    paths:\n      - src/**\n",
    );

    const { isError, heading, body } = await validate();

    expect(isError).toBe(false);
    expect(heading).toContain("is valid");
    expect(body).toMatchObject({
      path: ".github/pr-review-agents.yml",
      present: true,
      valid: true,
      usingDefaults: false,
      agents: [
        { agent: "security" },
        { agent: "test-coverage", model: "gpt-5", paths: ["src/**"] },
      ],
    });
    expect(body.agents[0].role).toEqual(expect.any(String));
  });

  it("reports an absent configuration as valid, using defaults", async () => {
    const { isError, heading, body } = await validate();

    expect(isError).toBe(false);
    expect(heading).toContain("using defaults");
    expect(body).toMatchObject({
      present: false,
      valid: true,
      usingDefaults: true,
      agents: [{ agent: "general" }],
    });
  });

  it("gives the line and column of a YAML syntax error", async () => {
    repo.write(".github/pr-review-agents.yml", "agents: [\n");

    const { isError, body } = await validate();

    expect(isError).toBe(false);
    expect(body).toMatchObject({ present: true, valid: false, location: { line: 2, column: 1 } });
    expect(body.error).toContain("is not valid YAML");
  });

  it("names the offending entry when an agent does not exist", async () => {
    repo.write(".github/pr-review-agents.yml", "agents:\n  - security\n  - sculpture\n");

    const { body } = await validate();

    expect(body.valid).toBe(false);
    expect(body.error).toContain('unknown built-in agent: "sculpture"');
    expect(body.error).toContain("test-coverage");
  });

  it("points at the entry index when one is not a name at all", async () => {
    repo.write(".github/pr-review-agents.yml", "agents:\n  - security\n  - focus: be nice\n");

    const { body } = await validate();

    expect(body.valid).toBe(false);
    expect(body.error).toContain("agents[1] does not name a built-in agent");
  });

  it("rejects a document with no agents", async () => {
    repo.write(".github/pr-review-agents.yml", "agents: []\n");

    const { body } = await validate();

    expect(body).toMatchObject({ valid: false });
    expect(body.error).toContain("agents");
  });

  it("validates a configuration at a path of its own", async () => {
    repo.write("config/agents.yml", "agents:\n  - docs-drift\n");

    const { body } = await validate({ configPath: "config/agents.yml" });

    expect(body).toMatchObject({
      path: "config/agents.yml",
      valid: true,
      agents: [{ agent: "docs-drift" }],
    });
  });

  it("reads a checkout other than the working directory", async () => {
    const other = createTestRepo({ ".github/pr-review-agents.yml": "agents:\n  - performance\n" });
    try {
      const { body } = await validate({ repoPath: other.root });
      expect(body).toMatchObject({ checkout: other.root, valid: true, agents: [{ agent: "performance" }] });
    } finally {
      other.remove();
    }
  });
});
