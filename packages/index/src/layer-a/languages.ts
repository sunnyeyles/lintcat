/** Extension → language id. Deliberately small: an unknown extension is null. */
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hh: "cpp",
  hpp: "cpp",
  swift: "swift",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  jsonc: "json",
  toml: "toml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
};

/** The last extension of a path's basename, lower-cased; "" when it has none. */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** The language id for a path, from its extension alone. */
export function languageOf(path: string): string | null {
  return LANGUAGE_BY_EXTENSION[extensionOf(path)] ?? null;
}
