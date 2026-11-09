import { asObject, asString, truncate } from "@/lib/run-trace/json";

const SUMMARY_MAX = 160;

export const SPAWN_TOOLS: ReadonlySet<string> = new Set(["Agent", "Task"]);
const READ_TOOLS: ReadonlySet<string> = new Set(["Read", "Grep", "Glob"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

const SUMMARY_FIELDS: Record<string, readonly string[]> = {
  Bash: ["command"],
  Read: ["file_path"],
  Edit: ["file_path"],
  MultiEdit: ["file_path"],
  Write: ["file_path"],
  NotebookEdit: ["notebook_path", "file_path"],
  Grep: ["pattern"],
  Glob: ["pattern"],
  WebFetch: ["url"],
  WebSearch: ["query"],
  Agent: ["description", "prompt"],
  Task: ["description", "prompt"],
  Skill: ["skill"],
  ToolSearch: ["query"],
};

function oneLine(text: string): string {
  return truncate(text.trim().split("\n")[0] ?? "", SUMMARY_MAX);
}

function firstString(input: Record<string, unknown>, fields: readonly string[]): string | undefined {
  for (const field of fields) {
    const value = asString(input[field]);
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

export function summariseInput(name: string, rawInput: unknown): string {
  const input = asObject(rawInput);
  if (!input) return "";
  const named = firstString(input, SUMMARY_FIELDS[name] ?? []);
  const where = (name === "Grep" || name === "Glob") && asString(input.path);
  if (named !== undefined) return oneLine(where ? `${named} in ${where}` : named);
  if (name === "TodoWrite" && Array.isArray(input.todos)) return `${input.todos.length} todos`;
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim() !== "") return oneLine(value);
  }
  return "";
}

export function touchedFile(
  name: string,
  rawInput: unknown,
): { kind: "read" | "edited"; path: string } | undefined {
  const input = asObject(rawInput);
  if (!input) return undefined;
  if (READ_TOOLS.has(name)) {
    const path = asString(name === "Read" ? input.file_path : input.path);
    return path ? { kind: "read", path } : undefined;
  }
  if (EDIT_TOOLS.has(name)) {
    const path = asString(input.file_path) ?? asString(input.notebook_path);
    return path ? { kind: "edited", path } : undefined;
  }
  return undefined;
}

export function relativeTo(cwd: string | undefined, path: string): string {
  if (!cwd) return path;
  const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  if (path === base) return ".";
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}
