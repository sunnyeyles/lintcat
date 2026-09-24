import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const primer = (theme: "light" | "dark") =>
  readFileSync(require.resolve(`@primer/primitives/dist/css/functional/themes/${theme}.css`), "utf8");
const brand = readFileSync(new URL("./brand.css", import.meta.url), "utf8");
const semantic = readFileSync(new URL("./theme.css", import.meta.url), "utf8");

type Tokens = Record<string, string>;

function parse(css: string): Tokens {
  const out: Tokens = {};
  for (const [, name = "", value = ""] of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[name] ??= value.trim();
  }
  return out;
}

function resolve(tokens: Tokens, name: string, depth = 0): string {
  const value = tokens[name];
  if (value === undefined) throw new Error(`missing token --${name}`);
  const ref = /^var\(--([\w-]+)\)$/.exec(value)?.[1];
  return ref !== undefined && depth < 8 ? resolve(tokens, ref, depth + 1) : value;
}

// Primer light/dark come first; brand.css wins because its blocks are written per theme.
function theme(name: "light" | "dark"): (token: string) => string {
  const block = (
    name === "light" ? /\[data-light-theme="light"\] \{([^}]*)\}/ : /\[data-dark-theme="dark"\] \{([^}]*)\}/
  ).exec(brand)?.[1];
  if (block === undefined) throw new Error(`no ${name} block in brand.css`);
  const aliases = parse(/:root \{([^}]*)\}/.exec(semantic)?.[1] ?? "");
  const tokens = { ...aliases, ...parse(primer(name).split("@media")[0] ?? ""), ...parse(block) };
  return (token) => resolve(tokens, token);
}

const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1, 7), 16);
  const channel = (byte: number) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

function contrast(a: string, b: string): number {
  for (const hex of [a, b]) {
    expect(hex, `expected an opaque hex colour, got ${hex}`).toMatch(/^#[0-9a-f]{6}$/i);
  }
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe.each(["light", "dark"] as const)("%s theme contrast", (name) => {
  const get = theme(name);
  const canvases = ["bgColor-default", "bgColor-muted", "bgColor-inset"];

  it("anchors the accent on the brand hex", () => {
    expect(get("bgColor-accent-emphasis")).toBe("#317a71");
  });

  it.each(canvases)("default text on %s is AAA", (canvas) => {
    expect(contrast(get("fgColor-default"), get(canvas))).toBeGreaterThanOrEqual(7);
  });

  it.each(canvases)("muted text on %s is AA", (canvas) => {
    expect(contrast(get("fgColor-muted"), get(canvas))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(canvases)("accent text on %s is AA", (canvas) => {
    expect(contrast(get("fgColor-accent"), get(canvas))).toBeGreaterThanOrEqual(4.5);
  });

  it("white on the accent emphasis is AA", () => {
    expect(contrast(get("fgColor-onEmphasis"), get("bgColor-accent-emphasis"))).toBeGreaterThanOrEqual(4.5);
  });

  it("white on the attention (severe) emphasis is AA", () => {
    expect(contrast(get("fgColor-onEmphasis"), get("bgColor-severe-emphasis"))).toBeGreaterThanOrEqual(4.5);
  });

  // Primer's own light border sits at 1.42:1; hold the brand to the same bar.
  it("borders stay visible on the canvas", () => {
    expect(contrast(get("borderColor-default"), get("bgColor-default"))).toBeGreaterThanOrEqual(1.4);
  });

  it("draws impacted map files apart from changed ones, both visible on the canvas", () => {
    const changed = get("map-module-changed");
    const impacted = get("map-module-impacted");
    expect(impacted).not.toBe(changed);
    for (const mark of [changed, impacted]) {
      expect(contrast(mark, get("bgColor-default"))).toBeGreaterThanOrEqual(3);
    }
  });
});
