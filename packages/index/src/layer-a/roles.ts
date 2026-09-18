/**
 * Path conventions → FileRole. Precedence: vendored, generated, migration,
 * test, asset, docs, config, then source.
 */
import type { FileRole } from "../types.js";
import { extensionOf } from "./languages.js";

const VENDOR_DIRECTORIES = new Set(["vendor", "node_modules", "third_party"]);

const GENERATED_DIRECTORIES = new Set(["dist", "build", ".next", "out"]);

const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
]);

const TEST_DIRECTORIES = new Set(["__tests__", "tests", "test"]);

const MANIFESTS = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "go.mod",
  "go.work",
  "Cargo.toml",
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Gemfile",
]);

const ASSET_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
  "mp3",
  "mp4",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "pdf",
  "zip",
  "gz",
  "tar",
  "wasm",
  "so",
  "dylib",
  "dll",
  "exe",
  "bin",
]);

const DOC_FILENAMES = new Set(["LICENSE", "LICENCE", "COPYING", "NOTICE"]);

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function isVendored(segments: readonly string[]): boolean {
  return segments.some((segment) => VENDOR_DIRECTORIES.has(segment));
}

function isGenerated(
  segments: readonly string[],
  base: string,
  path: string,
): boolean {
  return (
    segments.some((segment) => GENERATED_DIRECTORIES.has(segment)) ||
    path.includes("drizzle/meta/") ||
    LOCKFILES.has(base) ||
    /\.generated\./.test(base) ||
    base.endsWith(".pb.go") ||
    base.endsWith("_pb2.py") ||
    base.endsWith("_pb2.pyi")
  );
}

function isMigration(
  segments: readonly string[],
  extension: string,
  path: string,
): boolean {
  return (
    segments.includes("migrations") ||
    path.includes("db/migrate/") ||
    (extension === "sql" && segments.includes("drizzle"))
  );
}

function isTest(segments: readonly string[], base: string): boolean {
  return (
    segments.slice(0, -1).some((segment) => TEST_DIRECTORIES.has(segment)) ||
    /\.(test|spec)\.[^.]+$/.test(base) ||
    /\.eval\.[cm]?tsx?$/.test(base) ||
    base.endsWith("_test.go") ||
    /^test_.+\.py$/.test(base) ||
    /_test\.py$/.test(base)
  );
}

function isDocs(
  segments: readonly string[],
  base: string,
  language: string | null,
): boolean {
  return (
    language === "markdown" || segments[0] === "docs" || DOC_FILENAMES.has(base)
  );
}

function isConfig(
  segments: readonly string[],
  base: string,
  extension: string,
): boolean {
  return (
    base.startsWith(".") ||
    /\.config\.[^.]+$/.test(base) ||
    base.startsWith("tsconfig") ||
    MANIFESTS.has(base) ||
    base === "Dockerfile" ||
    base.startsWith("Dockerfile.") ||
    base === "Makefile" ||
    (segments[0] === ".github" && (extension === "yml" || extension === "yaml"))
  );
}

/** The role of a path; `language` is the id languageOf already resolved. */
export function roleOf(path: string, language: string | null): FileRole {
  const segments = path.split("/");
  const base = basenameOf(path);
  const extension = extensionOf(path);
  if (isVendored(segments)) return "vendored";
  if (isGenerated(segments, base, path)) return "generated";
  if (isMigration(segments, extension, path)) return "migration";
  if (isTest(segments, base)) return "test";
  if (ASSET_EXTENSIONS.has(extension)) return "asset";
  if (isDocs(segments, base, language)) return "docs";
  if (isConfig(segments, base, extension)) return "config";
  return "source";
}
