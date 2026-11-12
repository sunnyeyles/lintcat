import { asObject } from "@/lib/run-trace/json";
import { parseRun } from "@/lib/run-trace/parse-run";
import { baseName, jsonLines } from "@/lib/run-trace/adapters/build";
import type { TraceAdapter } from "@/lib/run-trace/adapters/types";

const TRANSCRIPT_TYPES = new Set(["user", "assistant", "summary", "system"]);

function looksLikeTranscript(text: string): boolean {
  return jsonLines(text, 20).some((line) => {
    const record = asObject(line);
    return typeof record?.sessionId === "string" && TRANSCRIPT_TYPES.has(String(record.type));
  });
}

export const claudeCodeAdapter: TraceAdapter = {
  id: "claude-code",
  label: "Claude Code / Agent SDK",
  hint: "a session's .jsonl transcript, with its subagents/ folder",
  detect(files) {
    const transcripts = files.filter((file) => baseName(file.name).endsWith(".jsonl"));
    if (transcripts.some((file) => looksLikeTranscript(file.text))) return 0.9;
    if (files.some((file) => /^agent-.+\.meta\.json$/.test(baseName(file.name)))) return 0.4;
    return 0;
  },
  parse(files) {
    return parseRun([...files]);
  },
};
