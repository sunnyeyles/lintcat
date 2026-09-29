/** The repository's written rules: CLAUDE.md, AGENTS.md and CONTRIBUTING.md, at the indexed commit. */
import { ancestorDirectories, basenameOf, directoryOf } from "#src/paths";

/** One rule doc, its text cut at MAX_RULE_DOC_CHARS. */
export interface RuleDoc {
  readonly path: string;
  readonly text: string;
  readonly truncated: boolean;
}

const RULE_DOC_NAMES = new Set(["claude.md", "agents.md", "contributing.md"]);

/** GitHub reads a CONTRIBUTING.md here as the whole repository's. */
const ROOT_EQUIVALENT_DIRECTORIES = new Set([".github", "docs"]);

const MAX_RULE_DOC_CHARS = 16_000;

const MAX_RULE_DOCS = 200;

export function isRuleDoc(path: string): boolean {
  return RULE_DOC_NAMES.has(basenameOf(path).toLowerCase());
}

/** The directory whose files a rule doc or config file governs. */
function scopeOf(path: string): string {
  const directory = directoryOf(path);
  const contributing = basenameOf(path).toLowerCase() === "contributing.md";
  return contributing && ROOT_EQUIVALENT_DIRECTORIES.has(directory) ? "" : directory;
}

/** Whether the file at `governing` applies to `path`: it sits in one of its ancestors. */
export function governs(governing: string, path: string): boolean {
  return ancestorDirectories(path).includes(scopeOf(governing));
}

/** Shallowest first, then by path, so the repository-wide docs lead. */
export function byDepthThenPath(a: string, b: string): number {
  const depth = a.split("/").length - b.split("/").length;
  return depth !== 0 ? depth : a < b ? -1 : a > b ? 1 : 0;
}

export function findRuleDocs(files: ReadonlyMap<string, string>): RuleDoc[] {
  return [...files.keys()]
    .filter((path) => isRuleDoc(path))
    .sort(byDepthThenPath)
    .slice(0, MAX_RULE_DOCS)
    .map((path) => {
      const text = files.get(path) ?? "";
      return {
        path,
        text: text.slice(0, MAX_RULE_DOC_CHARS),
        truncated: text.length > MAX_RULE_DOC_CHARS,
      };
    });
}
