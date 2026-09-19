export type Themed = { light: string; dark: string };

export const colors = {
  paper: { light: "#f3f5f7", dark: "#0c1116" },
  surface: { light: "#ffffff", dark: "#141b23" },
  "surface-2": { light: "#eaeef2", dark: "#1b242e" },
  ink: { light: "#10151c", dark: "#dfe6ed" },
  slate: { light: "#5a6878", dark: "#93a2b2" },
  // Icons, dots and dividers only: it cannot reach 4.5:1 and stay lighter than slate.
  "slate-dim": { light: "#7a8795", dark: "#6c7b8b" },
  rule: { light: "#aeb9c4", dark: "#3d4b59" },
  "rule-soft": { light: "#c5cfd9", dark: "#2f3c49" },
  accent: { light: "#10151c", dark: "#dfe6ed" },
  "accent-ink": { light: "#ffffff", dark: "#0c1116" },
  "accent-wash": { light: "#e2e8ee", dark: "#232e3a" },
  // Editorial crimson for the mark and emphasis; never on controls, where it reads as danger.
  brand: { light: "#b4133f", dark: "#ff5b80" },
  "brand-ink": { light: "#ffffff", dark: "#1a0710" },
  "brand-wash": { light: "#fbe9ee", dark: "#2a1119" },

  "agent-docs": { light: "#12666a", dark: "#4fbdb6" },
  "agent-security": { light: "#b4133f", dark: "#ff5b80" },
  "agent-correctness": { light: "#7e5a12", dark: "#d9a94a" },
  "agent-performance": { light: "#2f4ba0", dark: "#8ca0ee" },
  "agent-tests": { light: "#6b2c87", dark: "#c18fe2" },

  "sev-low": { light: "#5a6878", dark: "#93a2b2" },
  "sev-medium": { light: "#8a6010", dark: "#d9a94a" },
  "sev-high": { light: "#b4133f", dark: "#ff5b80" },

  ok: { light: "#12666a", dark: "#4fbdb6" },
  warn: { light: "#8a6010", dark: "#d9a94a" },
  stop: { light: "#b4133f", dark: "#ff5b80" },

  "code-bg": { light: "#10151c", dark: "#070b0f" },
  "code-fg": { light: "#dce4ec", dark: "#d3dce5" },
  "code-com": { light: "#7c8b9b", dark: "#7c8b9b" },
  "code-str": { light: "#6ecfc4", dark: "#6ecfc4" },
  "code-key": { light: "#ff7d9e", dark: "#ff7d9e" },
  "code-num": { light: "#e9b872", dark: "#e9b872" },
} as const satisfies Record<string, Themed>;

export type ColorToken = keyof typeof colors;

export const themed = {
  shadow: {
    light: "0 1px 2px rgb(16 21 28 / 0.05), 0 9px 27px -13px rgb(16 21 28 / 0.18)",
    dark: "0 1px 2px rgb(0 0 0 / 0.4), 0 9px 27px -13px rgb(0 0 0 / 0.7)",
  },
} as const satisfies Record<string, Themed>;

export const fixed = {
  measure: "67ch",
  "step-0": "clamp(1.02rem, .99rem + .16vw, 1.12rem)",
  "step-1": "clamp(1.24rem, 1.17rem + .34vw, 1.45rem)",
  "step-2": "clamp(1.55rem, 1.4rem + .72vw, 2.05rem)",
  "step-3": "clamp(2.1rem, 1.7rem + 1.9vw, 3.5rem)",
} as const;

type Theme = keyof Themed;

function block(selector: string, theme: Theme, indent = ""): string {
  const lines = [...Object.entries(colors), ...Object.entries(themed)].map(
    ([name, value]) => `${indent}  --${name}: ${value[theme]};`,
  );
  return `${indent}${selector} {\n${indent}  color-scheme: ${theme};\n${lines.join("\n")}\n${indent}}`;
}

// Explicit blocks, not light-dark(): getComputedStyle would return light-dark() unresolved.
export function renderTokensCss(): string {
  const fixedLines = Object.entries(fixed).map(([name, value]) => `  --${name}: ${value};`);
  return [
    "/* Generated from tokens.ts by `pnpm --filter @pr-review/design generate`. Do not edit. */",
    `:root {\n${fixedLines.join("\n")}\n}`,
    block(":root", "light"),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"])', "dark", "  ")}\n}`,
    block('[data-theme="dark"]', "dark"),
    "",
  ].join("\n\n");
}
