import { roleColor } from "@/app/dev/run-trace/trace-layout";

export type BotLook = { color: string; name: string };

export type CastRole = "locate" | "implementer" | "verify" | "deliver";

const CAST = new Map<string, CastRole>([
  ["factory", "deliver"],
  ["discovery", "locate"],
  ["locate", "locate"],
  ["architecture", "locate"],
  ["reproduce", "implementer"],
  ["implement", "implementer"],
  ["implementer", "implementer"],
  ["baseline", "verify"],
  ["verify", "verify"],
  ["review", "verify"],
  ["reviewer", "verify"],
  ["deploy-impact", "verify"],
  ["deliver", "deliver"],
]);

const KNOWN: { cast: CastRole; words: string[]; exact?: boolean }[] = [
  { cast: "deliver", words: ["main", "root", "run", "lead", "foreman", "orchestrator"], exact: true },
  {
    cast: "verify",
    words: [
      "review",
      "audit",
      "inspect",
      "test",
      "spec",
      "verif",
      "qa",
      "critic",
      "skeptic",
      "adversar",
      "breaker",
      "baseline",
      "check",
    ],
  },
  {
    cast: "implementer",
    words: ["implement", "code", "coder", "build", "fix", "develop", "engineer", "writ", "reproduc"],
  },
  {
    cast: "locate",
    words: ["plan", "explor", "search", "research", "locat", "architect", "design", "discover", "triage", "scout"],
  },
  { cast: "deliver", words: ["deliver", "ship", "deploy", "publish", "release", "commit"] },
];

const SPARE: CastRole[] = ["locate", "implementer", "verify", "deliver"];

const KNOWN_PREFIXES = ["marrow"];

function roleTokens(role: string): string[] {
  return role
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A factory agent's own character wins over its stage's. */
export function castRole(role: string, stage?: string): CastRole | undefined {
  return CAST.get(role) ?? (stage ? CAST.get(stage) : undefined);
}

/** Any agent's character: its factory role or stage, else the words in its role. */
export function castFor(role: string, stage?: string): CastRole {
  const exact = castRole(role, stage);
  if (exact) return exact;
  const tokens = roleTokens(displayRole(role));
  return (
    KNOWN.find((rule) =>
      tokens.some((token) => rule.words.some((word) => (rule.exact ? token === word : token.startsWith(word)))),
    )?.cast ?? SPARE[hash(role) % SPARE.length]
  );
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
  return { color: roleColor(role), name: displayRole(role, prefix) };
}

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}
