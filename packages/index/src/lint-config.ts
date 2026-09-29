/** The linter, formatter and typecheck configuration a repository runs, read at the indexed commit. */
import { basenameOf } from "#src/paths";
import { byDepthThenPath } from "#src/rule-docs";

/** One configuration file, and the part of it that says what is enforced. */
export interface LintConfig {
  /** The tool it configures, e.g. "ESLint", or "package.json scripts". */
  readonly tool: string;
  readonly path: string;
  /** Cut at MAX_EXCERPT_CHARS. */
  readonly excerpt: string;
}

const MAX_EXCERPT_CHARS = 1_200;

const MAX_LINT_CONFIGS = 200;

/** Matched against the lower-cased basename. */
const TOOLS: readonly (readonly [RegExp, string])[] = [
  [/^eslint\.config\.[cm]?[jt]s$|^\.eslintrc(\.(c?js|json|ya?ml))?$/, "ESLint"],
  [/^\.prettierrc(\.(json5?|ya?ml|toml|[cm]?js))?$|^prettier\.config\.[cm]?[jt]s$/, "Prettier"],
  [/^biome\.jsonc?$/, "Biome"],
  [/^\.oxlintrc\.json$/, "Oxlint"],
  [/^dprint\.jsonc?$/, "dprint"],
  [/^\.editorconfig$/, "EditorConfig"],
  [/^\.stylelintrc(\.(c?js|json|ya?ml))?$|^stylelint\.config\.[cm]?js$/, "Stylelint"],
  [/^\.markdownlint(\.(jsonc?|ya?ml))?$|^\.markdownlint-cli2\.(jsonc|ya?ml)$/, "markdownlint"],
  [/^tsconfig\.json$/, "TypeScript"],
  [/^\.?ruff\.toml$/, "Ruff"],
  [/^\.flake8$/, "Flake8"],
  [/^mypy\.ini$|^\.mypy\.ini$/, "mypy"],
  [/^\.golangci\.(ya?ml|toml|json)$/, "golangci-lint"],
  [/^\.?rustfmt\.toml$/, "rustfmt"],
  [/^\.?clippy\.toml$/, "Clippy"],
  [/^\.rubocop\.yml$/, "RuboCop"],
];

const SCRIPT_NAME = /lint|format|fmt|prettier|typecheck|type-check|tsc|check/i;

const PYPROJECT_SECTION = /^\[tool\.(ruff|black|isort|mypy|pylint|flake8)\b/;

function excerpt(text: string): string {
  return text.trim().slice(0, MAX_EXCERPT_CHARS);
}

/** The scripts that lint, format or typecheck, one `name: command` per line. */
function packageScripts(text: string): string | undefined {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    return undefined;
  }
  const scripts = (manifest as { scripts?: unknown } | null)?.scripts;
  if (typeof scripts !== "object" || scripts === null) {
    return undefined;
  }
  const lines = Object.entries(scripts)
    .filter(([name, command]) => SCRIPT_NAME.test(name) && typeof command === "string")
    .map(([name, command]) => `${name}: ${String(command)}`);
  return lines.length === 0 ? undefined : lines.join("\n");
}

/** The `[tool.<linter>]` sections of a pyproject.toml, whole. */
function pyprojectSections(text: string): string | undefined {
  const kept: string[] = [];
  let keeping = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("[")) {
      keeping = PYPROJECT_SECTION.test(line);
    }
    if (keeping) {
      kept.push(line);
    }
  }
  return kept.length === 0 ? undefined : kept.join("\n");
}

function configOf(path: string, text: string): LintConfig | undefined {
  const name = basenameOf(path).toLowerCase();
  if (name === "package.json") {
    const scripts = packageScripts(text);
    return scripts === undefined
      ? undefined
      : { tool: "package.json scripts", path, excerpt: excerpt(scripts) };
  }
  if (name === "pyproject.toml") {
    const sections = pyprojectSections(text);
    return sections === undefined
      ? undefined
      : { tool: "pyproject.toml tools", path, excerpt: excerpt(sections) };
  }
  const tool = TOOLS.find(([pattern]) => pattern.test(name))?.[1];
  return tool === undefined ? undefined : { tool, path, excerpt: excerpt(text) };
}

export function findLintConfigs(files: ReadonlyMap<string, string>): LintConfig[] {
  const configs: LintConfig[] = [];
  for (const [path, text] of files) {
    const config = configOf(path, text);
    if (config !== undefined) {
      configs.push(config);
    }
  }
  return configs
    .sort((a, b) => byDepthThenPath(a.path, b.path))
    .slice(0, MAX_LINT_CONFIGS);
}
