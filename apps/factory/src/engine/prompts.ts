/** Agent instructions and messages live as Markdown, one folder per role; the version hashes the whole folder. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { assetPath } from "#src/engine/assets";

export const MESSAGES = {
  discovery: ["outcome", "answer", "revise", "schema-retry", "no-more-questions", "resolve"],
  "spec-reviewer": ["review"],
  implementer: [
    "task",
    "checks",
    "reproduce",
    "implement",
    "implement-regression",
    "implement-baseline",
    "implement-placement",
    "repair",
    "repair-failure",
    "review-repair",
  ],
  reviewer: ["review", "diff-truncated"],
} as const;

type Role = keyof typeof MESSAGES;
type MessageName<R extends Role> = (typeof MESSAGES)[R][number];

export interface AgentPrompt {
  role: string;
  text: string;
  /** `<role>@<version>+<hash>`, so an edited prompt never shares a version. */
  version: string;
}

interface PromptSet extends AgentPrompt {
  messages: ReadonlyMap<string, string>;
}

const frontmatterSchema = z.object({ role: z.string(), version: z.number().int() });
const cache = new Map<string, PromptSet>();

// Never the repository being worked on: only the package's own folder or an explicit override.
const promptsDir = () => process.env.FACTORY_PROMPTS_DIR || assetPath("agents");

function loadSet(role: Role): PromptSet {
  const dir = path.resolve(promptsDir(), role);
  const cached = cache.get(dir);
  if (cached) return cached;

  const expected = ["system", ...MESSAGES[role]].map((name) => `${name}.md`).sort();
  const found = readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
  const missing = expected.filter((name) => !found.includes(name));
  const unexpected = found.filter((name) => !expected.includes(name));
  if (missing.length || unexpected.length) {
    throw new Error(`${dir}: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`);
  }

  const hash = createHash("sha256");
  const files = new Map<string, string>();
  for (const name of found) {
    const raw = readFileSync(path.join(dir, name), "utf8");
    hash.update(`${name}\0${raw}\0`);
    files.set(name.slice(0, -".md".length), raw);
  }

  const system = files.get("system") ?? "";
  const match = /^---\n([\s\S]*?)\n---\n/.exec(system);
  if (!match?.[1]) throw new Error(`${dir}/system.md has no frontmatter`);
  const meta = frontmatterSchema.parse(parse(match[1]));
  if (meta.role !== role) throw new Error(`${dir}/system.md declares role ${meta.role}`);

  files.delete("system");
  const messages = new Map([...files].map(([name, text]) => [name, text.trimEnd()]));
  const set: PromptSet = {
    role,
    text: system.slice(match[0].length).trim(),
    version: `${role}@${meta.version}+${hash.digest("hex").slice(0, 8)}`,
    messages,
  };
  cache.set(dir, set);
  return set;
}

export function loadPrompt(role: Role): AgentPrompt {
  const { text, version } = loadSet(role);
  return { role, text, version };
}

const SLOT = /\{\{(\w+)\}\}/g;

export function renderMessage<R extends Role>(role: R, name: MessageName<R>, vars: Record<string, string | number> = {}): string {
  const template = loadSet(role).messages.get(name);
  if (template === undefined) throw new Error(`no ${role}/${name}.md`);
  const slots = new Set([...template.matchAll(SLOT)].map((m) => m[1] ?? ""));
  const missing = [...slots].filter((slot) => !Object.hasOwn(vars, slot));
  const extra = Object.keys(vars).filter((key) => !slots.has(key));
  if (missing.length || extra.length) {
    throw new Error(`${role}/${name}.md: no value for [${missing.join(", ")}], no slot for [${extra.join(", ")}]`);
  }
  // One pass, so a value containing `{{x}}` is never expanded.
  return template.replace(SLOT, (_, slot: string) => String(vars[slot]));
}
