/**
 * CODEOWNERS: gitignore-like patterns, last matching rule wins. Hand-rolled
 * matching, so a pattern behaves the same here as it does on GitHub.
 */
import type { OwnerRule } from "../types.js";

/** Where GitHub looks for the file, in the order it looks. */
export const CODEOWNERS_PATHS: readonly string[] = [
  "CODEOWNERS",
  ".github/CODEOWNERS",
  "docs/CODEOWNERS",
];

function escapeSegment(part: string): string {
  return part
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
}

/** A pattern with an inner slash is anchored to the repository root. */
function isAnchored(pattern: string): boolean {
  return pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
}

function compile(pattern: string): RegExp | undefined {
  const directoryOnly = pattern.endsWith("/");
  const trimmed = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed === "") return undefined;
  const parts = trimmed.split("/");
  let source = "";
  parts.forEach((part, index) => {
    const last = index === parts.length - 1;
    if (part === "**") {
      source += last ? "[^/]+(?:/[^/]+)*" : "(?:[^/]+/)*";
    } else {
      source += escapeSegment(part) + (last ? "" : "/");
    }
  });
  const prefix = isAnchored(pattern) ? "^" : "^(?:.*/)?";
  // A pattern ending in a single `*` names files in one directory, not a subtree.
  const tail = directoryOnly
    ? "/.*$"
    : trimmed.endsWith("*") && !trimmed.endsWith("**")
      ? "$"
      : "(?:/.*)?$";
  return new RegExp(`${prefix}${source}${tail}`);
}

const compiled = new Map<string, RegExp | null>();

/** Compiled once per pattern: ownersOf runs against every file in the repo. */
function matcherFor(pattern: string): RegExp | null {
  const cached = compiled.get(pattern);
  if (cached !== undefined) return cached;
  const matcher = compile(pattern) ?? null;
  compiled.set(pattern, matcher);
  return matcher;
}

/** CODEOWNERS text → rules in file order; comments and blanks dropped. */
export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0]?.trim() ?? "";
    if (line === "") continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (pattern === undefined || pattern === "") continue;
    rules.push({ pattern, owners });
  }
  return rules;
}

/** The owners of a path: the last rule that matches it, or none. */
export function ownersOf(path: string, rules: readonly OwnerRule[]): string[] {
  let owners: readonly string[] = [];
  for (const rule of rules) {
    const matcher = matcherFor(rule.pattern);
    if (matcher !== null && matcher.test(path)) owners = rule.owners;
  }
  return [...owners];
}
