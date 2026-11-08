// Anonymised, cut-down shapes of real Claude Code transcripts (v2 `projects/` layout).
import type { RunFile } from "@/lib/run-trace/parse-run";

export const CWD = "/work/repo";
const SESSION = "sess-1";

type Line = Record<string, unknown>;

let clock = 0;
function at(): string {
  clock += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
}

function base(agentId?: string): Line {
  return {
    uuid: `u-${clock}`,
    sessionId: SESSION,
    cwd: CWD,
    isSidechain: agentId !== undefined,
    ...(agentId ? { agentId } : {}),
    timestamp: at(),
  };
}

export function prompt(text: string, agentId?: string): Line {
  return { ...base(agentId), type: "user", message: { role: "user", content: text } };
}

export function assistant(
  messageId: string,
  content: Line[],
  usage = { input_tokens: 2, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, output_tokens: 40 },
  agentId?: string,
): Line {
  return {
    ...base(agentId),
    type: "assistant",
    requestId: `req-${messageId}`,
    message: { model: "claude-test-1", id: messageId, type: "message", role: "assistant", content, usage },
  };
}

export function toolUse(id: string, name: string, input: Record<string, unknown>): Line {
  return { type: "tool_use", id, name, input };
}

export function toolResult(
  toolUseId: string,
  content: unknown,
  extra: { isError?: boolean; toolUseResult?: unknown; agentId?: string } = {},
): Line {
  return {
    ...base(extra.agentId),
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content, is_error: extra.isError ?? false }],
    },
    ...(extra.toolUseResult === undefined ? {} : { toolUseResult: extra.toolUseResult }),
  };
}

export function jsonl(lines: (Line | string)[]): string {
  return lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n");
}

/** Main → implementer (meta-less, linked by result agentId) → tester (meta); reviewer by prompt; one orphan. */
export function sampleRun(): RunFile[] {
  clock = 0;
  const usage = { input_tokens: 3, cache_read_input_tokens: 9000, cache_creation_input_tokens: 1000, output_tokens: 120 };
  const main = jsonl([
    { type: "queue-operation", operation: "enqueue", content: "Build it" },
    prompt("Build the feature"),
    { ...base(), type: "user", isMeta: true, message: { role: "user", content: "<local-command-caveat>x" } },
    assistant("msg_1", [{ type: "thinking", thinking: "Read a.ts first.", signature: "sig" }], usage),
    assistant("msg_1", [toolUse("toolu_read", "Read", { file_path: `${CWD}/src/a.ts` })], usage),
    toolResult("toolu_read", "export const a = 1;\n", { toolUseResult: { type: "text" } }),
    "{not json",
    "",
    { type: "ai-title", aiTitle: "Build the feature", sessionId: SESSION },
    assistant("msg_2", [
      { type: "text", text: "Spawning the implementer." },
      toolUse("toolu_impl", "Agent", {
        description: "Implement ticket",
        subagent_type: "implementer",
        prompt: "Implement ticket 1",
      }),
    ]),
    toolResult("toolu_impl", [{ type: "text", text: "Implemented." }], {
      toolUseResult: { status: "completed", agentId: "aimpl" },
    }),
    assistant("msg_3", [toolUse("toolu_rev", "Task", { description: "Review", prompt: "Review ticket 1" })]),
    toolResult("toolu_rev", [{ type: "text", text: "Looks fine." }]),
    { ...base(), type: "system", subtype: "stop_hook_summary" },
    assistant("msg_4", [{ type: "text", text: "Done." }]),
  ]);

  const implementer = jsonl([
    prompt("Implement ticket 1", "aimpl"),
    assistant("msg_i1", [toolUse("toolu_edit", "Edit", { file_path: `${CWD}/src/a.ts`, old_string: "1", new_string: "2" })], undefined, "aimpl"),
    toolResult("toolu_edit", "ok", { agentId: "aimpl" }),
    assistant("msg_i2", [toolUse("toolu_write", "Write", { file_path: "/elsewhere/b.ts", content: "x" })], undefined, "aimpl"),
    toolResult("toolu_write", "ok", { agentId: "aimpl" }),
    assistant("msg_i3", [toolUse("toolu_test", "Agent", { description: "Run tests", prompt: "Test it" })], undefined, "aimpl"),
    toolResult("toolu_test", [{ type: "text", text: "Async agent launched successfully.\nagentId: atest (internal)" }], {
      agentId: "aimpl",
    }),
  ]);

  const tester = jsonl([
    prompt("Test it", "atest"),
    assistant("msg_t1", [toolUse("toolu_bash", "Bash", { command: "pnpm test\n--run", description: "Run tests" })], undefined, "atest"),
    toolResult("toolu_bash", "x".repeat(5000), { isError: true, agentId: "atest" }),
  ]);

  const reviewer = jsonl([
    prompt("Review ticket 1", "arev"),
    assistant("msg_r1", [toolUse("toolu_grep", "Grep", { pattern: "TODO", path: `${CWD}/src` })], undefined, "arev"),
    toolResult("toolu_grep", "none", { agentId: "arev" }),
  ]);

  const orphan = jsonl([prompt("Nobody spawned me", "alost")]);

  return [
    { name: `${SESSION}.jsonl`, text: main },
    { name: "subagents/agent-aimpl.jsonl", text: implementer },
    { name: "subagents/agent-atest.jsonl", text: tester },
    {
      name: "subagents/agent-atest.meta.json",
      text: JSON.stringify({ agentType: "tester", description: "Run tests", toolUseId: "toolu_test" }),
    },
    { name: "subagents/agent-arev.jsonl", text: reviewer },
    { name: "subagents/agent-alost.jsonl", text: orphan },
  ];
}
