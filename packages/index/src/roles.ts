/**
 * What each path in a repository is. Path conventions only: nothing here
 * reads a file's contents.
 */

export type FileRole =
  | "vendored"
  | "generated"
  | "migration"
  | "test"
  | "config"
  | "docs"
  | "asset"
  | "source";

/**
 * Roles are checked in this order and the first match wins, so a test inside
 * `vendor/` is vendored and a `.json` under `docs/` is config.
 */
export const ROLE_PRECEDENCE: readonly FileRole[] = [
  "vendored",
  "generated",
  "migration",
  "test",
  "config",
  "docs",
  "asset",
  "source",
];

const VENDORED_DIRECTORIES = new Set([
  "bower_components",
  "Godeps",
  "node_modules",
  "third_party",
  "vendor",
]);

const GENERATED_DIRECTORIES = new Set([
  ".next",
  ".turbo",
  "__generated__",
  "build",
  "coverage",
  "dist",
  "out",
  "target",
]);

const GENERATED_FILES = new Set([
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "go.sum",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "yarn.lock",
]);

const MIGRATION_DIRECTORIES = new Set([
  "drizzle",
  "migrate",
  "migration",
  "migrations",
]);

const TEST_DIRECTORIES = new Set([
  "__mocks__",
  "__tests__",
  "e2e",
  "spec",
  "test",
  "tests",
]);

const DOC_DIRECTORIES = new Set(["doc", "docs"]);

const CONFIG_FILES = new Set([
  ".dockerignore",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  "dockerfile",
  "makefile",
  "package.json",
  "procfile",
]);

const CONFIG_EXTENSIONS = new Set([
  "cfg",
  "conf",
  "env",
  "ini",
  "json",
  "json5",
  "jsonc",
  "properties",
  "toml",
  "yaml",
  "yml",
]);

const DOC_FILES = new Set([
  "authors",
  "changelog",
  "codeowners",
  "contributing",
  "license",
  "notice",
  "readme",
]);

const DOC_EXTENSIONS = new Set(["adoc", "md", "mdx", "rst", "txt"]);

const ASSET_EXTENSIONS = new Set([
  "avif",
  "cjson",
  "css",
  "csv",
  "eot",
  "gif",
  "htm",
  "html",
  "ico",
  "jpeg",
  "jpg",
  "less",
  "png",
  "sass",
  "scss",
  "svg",
  "tsv",
  "ttf",
  "webp",
  "woff",
  "woff2",
]);

/** `foo.test.ts`, `foo.spec.tsx`, `review-quality.eval.ts`. */
const TEST_BASENAME = /\.(test|spec|eval)\.[cm]?[jt]sx?$/;

/** Go, Python and Ruby spell it the other way round. */
const TEST_BASENAME_OTHER = /(^test_.+\.py|_test\.(go|py|rb))$/;

const GENERATED_BASENAME = /(\.generated\.|\.min\.[cm]?js$|\.d\.[cm]?ts$)/;

const CONFIG_BASENAME = /\.config\.[cm]?[jt]sx?$/;

function directories(path: string): string[] {
  return path.split("/").slice(0, -1);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function extension(base: string): string {
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** The base name with every extension stripped, lowercased. */
function stem(base: string): string {
  const dot = base.indexOf(".", 1);
  return (dot < 0 ? base : base.slice(0, dot)).toLowerCase();
}

/** The role of one repository-relative path, by ROLE_PRECEDENCE. */
export function classifyFileRole(path: string): FileRole {
  const segments = directories(path);
  const base = basename(path);
  const lowered = base.toLowerCase();
  const ext = extension(base);
  const inside = (names: ReadonlySet<string>): boolean =>
    segments.some((segment) => names.has(segment));

  if (inside(VENDORED_DIRECTORIES)) {
    return "vendored";
  }
  if (
    inside(GENERATED_DIRECTORIES) ||
    GENERATED_FILES.has(lowered) ||
    GENERATED_BASENAME.test(lowered)
  ) {
    return "generated";
  }
  if (inside(MIGRATION_DIRECTORIES)) {
    return "migration";
  }
  if (
    inside(TEST_DIRECTORIES) ||
    TEST_BASENAME.test(lowered) ||
    TEST_BASENAME_OTHER.test(lowered)
  ) {
    return "test";
  }
  if (
    CONFIG_FILES.has(lowered) ||
    CONFIG_EXTENSIONS.has(ext) ||
    CONFIG_BASENAME.test(lowered) ||
    (ext === "" && lowered.startsWith("."))
  ) {
    return "config";
  }
  if (
    inside(DOC_DIRECTORIES) ||
    DOC_EXTENSIONS.has(ext) ||
    DOC_FILES.has(stem(lowered))
  ) {
    return "docs";
  }
  if (ASSET_EXTENSIONS.has(ext)) {
    return "asset";
  }
  return "source";
}
