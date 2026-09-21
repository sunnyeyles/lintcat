import { GENERAL_AGENT, type ReviewModel } from "@pr-review/ai";
import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it } from "vitest";

import { staticClient } from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";
import { selectReviewEngine } from "#src/review-engine";

function environment(env: Record<string, string | undefined>): McpEnvironment {
  return {
    env,
    cwd: "/nowhere",
    logger: createCapturingLogger().logger,
    createLanguageModel: () => ({ provider: "test", modelId: "test-model" }) as ReviewModel,
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

describe("choosing how a review runs", () => {
  it("runs the tool-calling agent when a provider key is set", () => {
    const selected = selectReviewEngine(
      environment({ OPENAI_API_KEY: "sk-test" }),
      staticClient({ sampling: true }),
    );

    expect(selected.singleShot).toBe(false);
    expect(selected.engine).toHaveProperty("model");
  });

  it("falls back to one sampling agent when no key is set and the client samples", () => {
    const selected = selectReviewEngine(
      environment({}),
      staticClient({ sampling: true }),
    );

    expect(selected.singleShot).toBe(true);
    expect(selected.engine).toHaveProperty("createAgent");
  });

  it("builds a general agent over the client's sampling", () => {
    const client = staticClient({ sampling: true }, [], async () => "{}");
    const engine = selectReviewEngine(environment({}), client).engine;
    if (!("createAgent" in engine)) {
      throw new Error("expected the sampling engine");
    }

    const agent = engine.createAgent({
      client: {} as never,
      agent: GENERAL_AGENT,
      index: undefined,
      logger: createCapturingLogger().logger,
    });

    expect(agent).toMatchObject({ name: "general" });
  });

  it("names both ways out when there is no key and no sampling", () => {
    expect(() => selectReviewEngine(environment({}), staticClient())).toThrow(
      /No model API key is set and this client does not offer sampling/,
    );
  });

  it("points at the provider key environment variables and at sampling", () => {
    expect(() => selectReviewEngine(environment({}), staticClient())).toThrow(
      /ANTHROPIC_API_KEY.*sampling\/createMessage/s,
    );
  });
});
