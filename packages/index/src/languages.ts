/** Which language a path is written in, and what the index saw of each. */

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  ["c", "c"],
  ["cc", "cpp"],
  ["cjs", "javascript"],
  ["cpp", "cpp"],
  ["cs", "csharp"],
  ["css", "css"],
  ["cts", "typescript"],
  ["go", "go"],
  ["h", "c"],
  ["hpp", "cpp"],
  ["java", "java"],
  ["js", "javascript"],
  ["json", "json"],
  ["jsx", "javascript"],
  ["kt", "kotlin"],
  ["md", "markdown"],
  ["mdx", "markdown"],
  ["mjs", "javascript"],
  ["mts", "typescript"],
  ["php", "php"],
  ["py", "python"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["scss", "css"],
  ["sh", "shell"],
  ["sql", "sql"],
  ["swift", "swift"],
  ["toml", "toml"],
  ["ts", "typescript"],
  ["tsx", "typescript"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
]);

/** "other" for anything with no extension this map knows. */
export function languageOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "other";
  }
  return LANGUAGE_BY_EXTENSION.get(base.slice(dot + 1).toLowerCase()) ?? "other";
}

/** The languages whose imports the builder parses. Everything else is seen only. */
export const INDEXED_LANGUAGES: ReadonlySet<string> = new Set([
  "typescript",
  "javascript",
]);

/** What the index saw of one language, and whether it parsed any of it. */
export interface LanguageCoverage {
  language: string;
  /** Files of this language the index read. */
  files: number;
  /** True only where imports were parsed; elsewhere the file was merely seen. */
  indexed: boolean;
}

/** Counts files per language, commonest first. */
export function summariseLanguages(
  languages: Iterable<string>,
): LanguageCoverage[] {
  const counts = new Map<string, number>();
  for (const language of languages) {
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts]
    .map(([language, files]) => ({
      language,
      files,
      indexed: INDEXED_LANGUAGES.has(language),
    }))
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}
