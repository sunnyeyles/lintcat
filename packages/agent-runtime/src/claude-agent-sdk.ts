/** The Claude Agent SDK behind the AgentRuntime contract. */
import { accessSync, constants } from "node:fs";
import path from "node:path";

import {
  createSdkMcpServer,
  query,
  tool,
  type AccountInfo,
  type HookCallback,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { checkToolPath } from "#src/path-guard";
import {
  AgentAuthError,
  type AgentEvent,
  type AgentSpec,
  type AgentRuntime,
  type AgentUsage,
  type AuthMode,
} from "#src/runtime";

const TOOL_SERVER = "factory";
const READ_TOOLS = ["Read", "Glob", "Grep"];
const WRITE_TOOLS = ["Edit", "Write"];

// Any of these outranks the subscription login in Claude Code's credential order.
const CREDENTIAL_OVERRIDES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"];
const NEVER_PASSED = ["DATABASE_URL", "FACTORY_DATABASE_URL", "GITHUB_TOKEN", "GH_TOKEN"];

export interface ClaudeRuntimeOptions {
  auth: AuthMode;
  /** The installed `claude` binary; found on PATH when omitted. */
  executable?: string;
  env?: NodeJS.ProcessEnv;
}

export function agentEnvironment(auth: AuthMode, source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || NEVER_PASSED.includes(key)) continue;
    if (key.startsWith("CLAUDE_CODE_USE_")) continue;
    if (auth === "subscription" && CREDENTIAL_OVERRIDES.includes(key)) continue;
    env[key] = value;
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "lintcat-factory/0.1";
  return env;
}

/** Null when the credential Claude Code chose matches the mode, else why not. */
export function authMismatch(
  auth: AuthMode,
  apiKeySource: string,
  account: Pick<AccountInfo, "apiProvider" | "subscriptionType">,
): string | null {
  if (auth === "api-key") {
    return apiKeySource === "ANTHROPIC_API_KEY"
      ? null
      : `expected ANTHROPIC_API_KEY auth, Claude Code used ${apiKeySource}`;
  }
  if (apiKeySource !== "none") return `expected the subscription login, Claude Code used ${apiKeySource}`;
  if (account.apiProvider && account.apiProvider !== "firstParty") {
    return `expected the subscription login, Claude Code used provider ${account.apiProvider}`;
  }
  if (!account.subscriptionType) {
    return "no Claude subscription login found: run `claude` and /login, or set CLAUDE_CODE_OAUTH_TOKEN";
  }
  return null;
}

function findOnPath(binary: string, pathVariable = process.env.PATH ?? ""): string | undefined {
  for (const dir of pathVariable.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function usageOf(message: Extract<SDKMessage, { type: "result" }>): AgentUsage {
  const usage = message.usage;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    estimatedCostUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : null,
  };
}

/** The runtime-neutral events one SDK message carries. */
export function translateMessage(message: SDKMessage): AgentEvent[] {
  if (message.type === "assistant") {
    const events: AgentEvent[] = [];
    for (const block of message.message.content) {
      if (block.type === "text") events.push({ type: "text", text: block.text });
      if (block.type === "tool_use") events.push({ type: "tool_call", name: block.name, input: block.input });
    }
    return events;
  }
  if (message.type === "user") {
    const content = message.message.content;
    if (typeof content === "string") return [];
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (block.type === "tool_result") events.push({ type: "tool_result", isError: block.is_error === true });
    }
    return events;
  }
  if (message.type === "result") {
    const ok = message.subtype === "success" && !message.is_error;
    return [
      {
        type: "result",
        ok,
        reason: message.subtype,
        text: message.subtype === "success" ? message.result : "",
        structured: message.subtype === "success" ? message.structured_output : undefined,
        turns: message.num_turns,
        durationMs: message.duration_ms,
        usage: usageOf(message),
      },
    ];
  }
  return [];
}

// Claude Code's validator rejects a `$schema` dialect URI it hasn't registered, such as Zod's 2020-12.
export function withoutDialect(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = schema;
  return rest;
}

function guardHook(root: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const reason = checkToolPath(root, input.tool_input);
    if (!reason) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  };
}

export function createClaudeRuntime(options: ClaudeRuntimeOptions): AgentRuntime {
  const source = options.env ?? process.env;
  const executable = options.executable ?? findOnPath("claude", source.PATH);

  return {
    name: "claude-agent-sdk",
    async *run(spec: AgentSpec): AsyncIterable<AgentEvent> {
      const abortController = new AbortController();
      const abort = () => abortController.abort();
      spec.signal?.addEventListener("abort", abort, { once: true });

      const builtIn = spec.readOnly ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS];
      const custom = spec.tools ?? [];
      const sdkOptions: Options = {
        abortController,
        cwd: spec.cwd,
        env: agentEnvironment(options.auth, source),
        // The target repo's own hooks and MCP servers would run on the host, outside the sandbox.
        settingSources: [],
        strictMcpConfig: true,
        tools: builtIn,
        permissionMode: spec.readOnly ? "default" : "acceptEdits",
        canUseTool: async (toolName, input, { mcpServer }) => {
          const reason = checkToolPath(spec.cwd, input);
          if (reason) return { behavior: "deny", message: reason };
          if (builtIn.includes(toolName)) return { behavior: "allow", updatedInput: input };
          // Trust is keyed on the SDK-registered source, never on the tool name alone.
          const hostTool = custom.some((t) => toolName === `mcp__${TOOL_SERVER}__${t.name}`);
          if (hostTool && mcpServer?.source === "sdk" && mcpServer.name === TOOL_SERVER) {
            return { behavior: "allow", updatedInput: input };
          }
          return { behavior: "deny", message: `${toolName} is not available in this run` };
        },
        hooks: { PreToolUse: [{ hooks: [guardHook(spec.cwd)] }] },
        systemPrompt: spec.systemPrompt,
        maxTurns: spec.maxTurns,
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
        ...(spec.model ? { model: spec.model } : {}),
        ...(spec.resumeSessionId ? { resume: spec.resumeSessionId } : {}),
        ...(spec.outputSchema ? { outputFormat: { type: "json_schema", schema: withoutDialect(spec.outputSchema) } } : {}),
        ...(custom.length > 0
          ? {
              mcpServers: {
                [TOOL_SERVER]: createSdkMcpServer({
                  name: TOOL_SERVER,
                  tools: custom.map((t) =>
                    tool(t.name, t.description, t.input, async (args) => {
                      const result = await t.handler(args);
                      return {
                        content: [{ type: "text", text: result.text }],
                        ...(result.isError ? { isError: true } : {}),
                      };
                    }),
                  ),
                }),
              },
            }
          : {}),
      };

      const run = query({ prompt: spec.prompt, options: sdkOptions });
      try {
        for await (const message of run) {
          if (message.type === "system" && message.subtype === "init") {
            const account = await run.accountInfo();
            const mismatch = authMismatch(options.auth, message.apiKeySource, account);
            if (mismatch) throw new AgentAuthError(mismatch);
            yield {
              type: "auth",
              mode: options.auth,
              credentialSource: options.auth === "subscription" ? "claude-login" : message.apiKeySource,
              subscription: account.subscriptionType ?? null,
            };
            yield { type: "session", sessionId: message.session_id };
            continue;
          }
          yield* translateMessage(message);
        }
      } finally {
        spec.signal?.removeEventListener("abort", abort);
        abortController.abort();
      }
    },
  };
}
