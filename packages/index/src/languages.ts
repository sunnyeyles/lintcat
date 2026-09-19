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

/** How much of what a language imports from inside the repository was placed. */
export interface ImportResolution {
  /** Imports that are not third-party: relative, alias, or a package of this tree. */
  internal: number;
  /** Of those, the ones pointing at a file the index holds. */
  resolved: number;
  /** resolved ÷ internal, 1 when the language imports nothing internal. */
  rate: number;
}

/** What the index saw of one language, and whether it parsed any of it. */
export interface LanguageCoverage {
  language: string;
  /** Files of this language the index read. */
  files: number;
  /** True only where imports were parsed; elsewhere the file was merely seen. */
  indexed: boolean;
  /** Present only for an indexed language, whose imports were resolved. */
  resolution?: ImportResolution;
}

/** Counts, per language, how many internal imports were placed in the tree. */
export type ResolutionTally = ReadonlyMap<
  string,
  { internal: number; resolved: number }
>;

function resolutionOf(
  language: string,
  tally: ResolutionTally,
): ImportResolution {
  const counted = tally.get(language) ?? { internal: 0, resolved: 0 };
  const rate =
    counted.internal === 0 ? 1 : counted.resolved / counted.internal;
  return { ...counted, rate: Math.round(rate * 1000) / 1000 };
}

/** Counts files per language, commonest first. */
export function summariseLanguages(
  languages: Iterable<string>,
  tally: ResolutionTally = new Map(),
): LanguageCoverage[] {
  const counts = new Map<string, number>();
  for (const language of languages) {
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts]
    .map(([language, files]) => {
      const indexed = INDEXED_LANGUAGES.has(language);
      return {
        language,
        files,
        indexed,
        ...(indexed ? { resolution: resolutionOf(language, tally) } : {}),
      };
    })
    .sort((a, b) => b.files - a.files || a.language.localeCompare(b.language));
}
