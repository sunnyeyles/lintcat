import { roleColor } from "@/app/dev/run-trace/trace-layout";

export type Accessory =
  | "hat"
  | "clipboard"
  | "magnifier"
  | "wrench"
  | "glasses"
  | "eyebrow"
  | "antenna"
  | "propeller"
  | "headphones"
  | "bowtie"
  | "flower";

export type BotLook = { accessory: Accessory; color: string; name: string };

const KNOWN: { accessory: Accessory; words: string[]; exact?: boolean }[] = [
  {
    accessory: "hat",
    words: ["main", "root", "run", "lead", "foreman", "orchestrator"],
    exact: true,
  },
  {
    accessory: "eyebrow",
    words: ["skeptic", "critic", "qa", "adversar", "breaker"],
  },
  { accessory: "glasses", words: ["review", "audit", "inspect"] },
  { accessory: "magnifier", words: ["test", "spec", "verif"] },
  { accessory: "clipboard", words: ["plan", "triage", "design", "architect"] },
  {
    accessory: "wrench",
    words: ["implement", "code", "coder", "build", "fix", "develop", "engineer"],
  },
];

const SPARE: Accessory[] = ["antenna", "propeller", "headphones", "bowtie", "flower"];

const KNOWN_PREFIXES = ["marrow"];

export function roleTokens(role: string): string[] {
  return role
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The namespace every multi-part role in a run shares, e.g. "marrow-". */
export function commonPrefix(roles: string[]): string {
  const namespaced = [...new Set(roles)].filter((role) => /^[a-z0-9]+[-_:/.]/i.test(role));
  if (namespaced.length < 2) return "";
  const first = /^[a-z0-9]+[-_:/.]/i.exec(namespaced[0])?.[0] ?? "";
  return namespaced.every((role) => role.startsWith(first)) ? first : "";
}

export function displayRole(role: string, prefix = ""): string {
  let name = prefix && role.startsWith(prefix) ? role.slice(prefix.length) : role;
  for (const known of KNOWN_PREFIXES) {
    const match = new RegExp(`^${known}[-_:/.]`, "i").exec(name);
    if (match && name.length > match[0].length) name = name.slice(match[0].length);
  }
  return name || role;
}

export function botLook(role: string, prefix = ""): BotLook {
  const name = displayRole(role, prefix);
  const tokens = roleTokens(name);
  const accessory =
    KNOWN.find((rule) =>
      tokens.some((token) => rule.words.some((word) => (rule.exact ? token === word : token.startsWith(word)))),
    )?.accessory ?? SPARE[hash(name) % SPARE.length];
  return { accessory, color: roleColor(role), name };
}

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}
