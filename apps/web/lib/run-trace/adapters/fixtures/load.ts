import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import type { RunFile } from "@/lib/run-trace/adapters/types";

const DIR = new URL(".", import.meta.url).pathname;

export const FIXTURES = {
  "claude-code": "claude-code",
  "otel-genai": "otel-genai.json",
  "openai-agents": "openai-agents.json",
  lintcat: "lintcat-run.ndjson",
  "lintcat-factory": "factory-run.json",
} as const;

export type FixtureId = keyof typeof FIXTURES;

function walk(path: string): string[] {
  return statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => walk(join(path, name))) : [path];
}

/** A fixture as a drop would deliver it: paths relative to the dropped item's parent. */
export function loadFixture(id: FixtureId): RunFile[] {
  const root = join(DIR, FIXTURES[id]);
  return walk(root).map((path) => ({ name: relative(DIR, path), text: readFileSync(path, "utf8") }));
}
