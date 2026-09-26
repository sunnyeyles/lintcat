/** Who owns a path, by GitHub's CODEOWNERS rules. */
import { globSource } from "#src/paths";

export interface CodeownersRule {
  readonly pattern: string;
  /** `@user` and `@org/team` owners as written; empty un-assigns the path. */
  readonly owners: readonly string[];
  readonly matcher: RegExp;
}

const LOCATIONS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

/** Negation and character classes, which GitHub does not support. */
const UNSUPPORTED = /^!|\[/;

function patternToRegExp(pattern: string): RegExp {
  const directoryOnly = pattern.endsWith("/");
  const trimmed = pattern.replace(/^\//, "").replace(/\/$/, "");
  const anchored = pattern.startsWith("/") || trimmed.includes("/");
  const head = anchored ? "" : "(?:.*/)?";
  // GitHub departs from gitignore here: `docs/*` owns only docs' direct children.
  const tail = directoryOnly
    ? "/.*"
    : trimmed.split("/").at(-1) === "*"
      ? ""
      : "(?:/.*)?";
  return new RegExp(`^${head}${globSource(trimmed)}${tail}$`);
}

/** The pattern and owners of one line, before any trailing comment. */
function tokensOf(line: string): string[] {
  const tokens = line.trim().split(/(?<!\\)\s+/);
  const comment = tokens.findIndex((token) => token.startsWith("#"));
  return (comment < 0 ? tokens : tokens.slice(0, comment)).filter(
    (token) => token !== "",
  );
}

/** Skips lines GitHub cannot honour; email owners are dropped. */
export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const line of text.split("\n")) {
    const [pattern, ...owners] = tokensOf(line);
    if (pattern === undefined || UNSUPPORTED.test(pattern)) {
      continue;
    }
    rules.push({
      pattern,
      owners: owners.filter((owner) => owner.startsWith("@")),
      matcher: patternToRegExp(pattern),
    });
  }
  return rules;
}

/** The owners of the last rule matching `path`, or none. */
export function ownersOf(
  rules: readonly CodeownersRule[],
  path: string,
): string[] {
  const rule = rules.findLast((candidate) => candidate.matcher.test(path));
  return rule === undefined ? [] : [...rule.owners];
}

/** The text of the CODEOWNERS file GitHub reads, first location found winning. */
export function findCodeowners(
  files: ReadonlyMap<string, string>,
): string | undefined {
  return LOCATIONS.map((path) => files.get(path)).find(
    (text) => text !== undefined,
  );
}
