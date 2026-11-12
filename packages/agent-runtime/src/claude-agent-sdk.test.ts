import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

import { agentEnvironment, authMismatch, translateMessage, withoutDialect } from "#src/claude-agent-sdk";

describe("agentEnvironment", () => {
  const source = {
    PATH: "/bin",
    HOME: "/home/me",
    ANTHROPIC_API_KEY: "sk-ant-x",
    ANTHROPIC_AUTH_TOKEN: "t",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_OAUTH_TOKEN: "oauth",
    DATABASE_URL: "postgres://secret",
    GH_TOKEN: "ghp",
  };

  it("drops every credential that would outrank the subscription login", () => {
    const env = agentEnvironment("subscription", source);
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(env).not.toHaveProperty("CLAUDE_CODE_USE_BEDROCK");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth");
    expect(env.PATH).toBe("/bin");
  });

  it("keeps the API key in api-key mode but never passes factory secrets", () => {
    const env = agentEnvironment("api-key", source);
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-x");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("GH_TOKEN");
  });
});

describe("authMismatch", () => {
  it("accepts a first-party subscription login", () => {
    expect(authMismatch("subscription", "none", { apiProvider: "firstParty", subscriptionType: "Claude Max" })).toBeNull();
  });

  it("rejects an API key or a missing login in subscription mode", () => {
    expect(authMismatch("subscription", "ANTHROPIC_API_KEY", { subscriptionType: "Max" })).toMatch(/ANTHROPIC_API_KEY/);
    expect(authMismatch("subscription", "none", { apiProvider: "bedrock" })).toMatch(/bedrock/);
    expect(authMismatch("subscription", "none", {})).toMatch(/no Claude subscription/);
  });

  it("requires the environment key in api-key mode", () => {
    expect(authMismatch("api-key", "ANTHROPIC_API_KEY", {})).toBeNull();
    expect(authMismatch("api-key", "none", {})).toMatch(/expected ANTHROPIC_API_KEY/);
  });
});

describe("withoutDialect", () => {
  it("drops only the $schema dialect URI", () => {
    expect(withoutDialect({ $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" })).toEqual({ type: "object" });
  });
});

describe("translateMessage", () => {
  it("maps tool calls, tool results and the final result", () => {
    const assistant = {
      type: "assistant",
      message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", id: "1", name: "Read", input: { file_path: "a" } }] },
    } as unknown as SDKMessage;
    const user = {
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "1", is_error: true, content: "x" }] },
    } as unknown as SDKMessage;
    const result = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      structured_output: { a: 1 },
      num_turns: 3,
      duration_ms: 10,
      total_cost_usd: 0.5,
      usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 },
    } as unknown as SDKMessage;

    expect(translateMessage(assistant)).toEqual([
      { type: "text", text: "hi" },
      { type: "tool_call", name: "Read", input: { file_path: "a" } },
    ]);
    expect(translateMessage(user)).toEqual([{ type: "tool_result", isError: true }]);
    expect(translateMessage(result)).toEqual([
      {
        type: "result",
        ok: true,
        reason: "success",
        text: "done",
        structured: { a: 1 },
        turns: 3,
        durationMs: 10,
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, estimatedCostUsd: 0.5 },
      },
    ]);
  });
});
