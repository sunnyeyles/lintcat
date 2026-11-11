/** Agent instructions live as Markdown; the version recorded on every event includes a content hash. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { z } from "zod";

import { assetPath } from "#src/assets";

export interface AgentPrompt {
  role: string;
  text: string;
  /** `<role>@<version>+<hash>`, so an edited prompt never shares a version. */
  version: string;
}

const frontmatterSchema = z.object({ role: z.string(), version: z.number().int() });

export function loadPrompt(role: "discovery" | "implementer"): AgentPrompt {
  const raw = readFileSync(assetPath("agents", `${role}.md`), "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match?.[1]) throw new Error(`agents/${role}.md has no frontmatter`);
  const meta = frontmatterSchema.parse(parse(match[1]));
  const text = raw.slice(match[0].length).trim();
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 8);
  return { role: meta.role, text, version: `${meta.role}@${meta.version}+${hash}` };
}
