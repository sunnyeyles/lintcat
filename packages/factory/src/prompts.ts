/** Every agent prompt lives as Markdown, one folder per role; the recorded version hashes the whole folder. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { assetPath } from "#src/assets";

const MESSAGES = {
  discovery: ["outcome", "more-context", "answer", "no-answer", "revise", "schema-retry", "no-more-questions", "scoping"],
  scoper: ["scope"],
  implementer: [
    "task",
    "architecture",
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

export type Role = keyof typeof MESSAGES;
type MessageName<R extends Role> = (typeof MESSAGES)[R][number];

export interface AgentPrompt {
  role: string;
  text: string;
  /** `<role>@<version>+<hash>`; the hash covers every file in the role's folder. */
  version: string;
}

interface PromptSet {
  system: AgentPrompt;
  messages: Map<string, string>;
}

const frontmatterSchema = z.object({ role: z.string(), version: z.number().int() });
const SLOT = /\{\{([a-zA-Z][\w-]*)\}\}/g;
const cache = new Map<string, PromptSet>();

// Operator-only: prompts never come from the repository under work.
const promptsDir = () => (process.env.FACTORY_PROMPTS_DIR ? path.resolve(process.env.FACTORY_PROMPTS_DIR) : assetPath("agents"));

function load(role: Role): PromptSet {
  const dir = path.join(promptsDir(), role);
  const hit = cache.get(dir);
  if (hit) return hit;
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  const expected = ["system", ...MESSAGES[role]].map((name) => `${name}.md`);
  const missing = expected.filter((f) => !files.includes(f));
  const unexpected = files.filter((f) => !expected.includes(f));
  if (missing.length || unexpected.length) {
    throw new Error(`prompt set ${dir}: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`);
  }
  const hash = createHash("sha256");
  const messages = new Map<string, string>();
  let system: { meta: z.infer<typeof frontmatterSchema>; text: string } | undefined;
  for (const file of files) {
    const raw = readFileSync(path.join(dir, file), "utf8");
    if (file === "system.md") {
      const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
      if (!match?.[1]) throw new Error(`${dir}/system.md has no frontmatter`);
      system = { meta: frontmatterSchema.parse(parse(match[1])), text: raw.slice(match[0].length).trim() };
      hash.update(`${file}\0${system.text}\0`);
    } else {
      const text = raw.replace(/\n+$/, "");
      messages.set(file.slice(0, -".md".length), text);
      hash.update(`${file}\0${text}\0`);
    }
  }
  if (!system) throw new Error(`${dir}/system.md is missing`);
  if (system.meta.role !== role) throw new Error(`${dir}/system.md declares role ${system.meta.role}`);
  const version = `${role}@${system.meta.version}+${hash.digest("hex").slice(0, 8)}`;
  const set = { system: { role, text: system.text, version }, messages };
  cache.set(dir, set);
  return set;
}

export function loadPrompt(role: Role): AgentPrompt {
  return load(role).system;
}

/** Fills a message template; a slot without a value, or a value without a slot, is a bug and throws. */
export function renderMessage<R extends Role>(role: R, name: MessageName<R>, vars: Record<string, string | number> = {}): string {
  const template = load(role).messages.get(name);
  if (template === undefined) throw new Error(`no ${role}/${name}.md`);
  const slots = new Set([...template.matchAll(SLOT)].map((m) => m[1]!));
  const missing = [...slots].filter((slot) => !(slot in vars));
  const unused = Object.keys(vars).filter((key) => !slots.has(key));
  if (missing.length || unused.length) {
    throw new Error(`${role}/${name}.md: no value for [${missing.join(", ")}], no slot for [${unused.join(", ")}]`);
  }
  return template.replace(SLOT, (_, slot: string) => String(vars[slot]));
}
