/** How a TypeScript or JavaScript file exports, read from its masked text. */
import { maskSource } from "#src/imports";

/** "default" when the module has a default export at all, types beside it included. */
export type ExportStyle = "default" | "named";

const DEFAULT_EXPORT = [
  /(?<![\w$.])export\s+default\b/,
  /(?<![\w$.])export\s*=/,
  /(?<![\w$.])export\s*\{[^}]*\bas\s+default\b/,
  /(?<![\w$.])module\.exports\s*=/,
];

const NAMED_EXPORT = [
  /(?<![\w$.])export\s+(?!default\b)[\w$*{]/,
  /(?<![\w$.])export\s*[{*]/,
  /(?<![\w$.])(?:module\.)?exports\.[\w$]+\s*=/,
];

/** Undefined for a module that exports nothing. */
export function exportStyleOf(source: string): ExportStyle | undefined {
  const { text } = maskSource(source);
  if (DEFAULT_EXPORT.some((pattern) => pattern.test(text))) {
    return "default";
  }
  return NAMED_EXPORT.some((pattern) => pattern.test(text)) ? "named" : undefined;
}
