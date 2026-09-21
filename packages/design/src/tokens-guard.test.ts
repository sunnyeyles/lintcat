import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url).pathname;
const SCANNED = ["apps/web/app", "apps/web/components", "apps/web/lib", "packages/design/src/components"];

const HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PALETTE_CLASS = new RegExp(
  `\\b(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|from|via|to|outline|shadow|decoration|accent|caret|divide)-(?:${HUES})-\\d{2,3}(?:/\\d+)?\\b`,
  "g",
);
const RAW_HEX = /#[0-9a-fA-F]{6}\b/g;

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(tsx?|css)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) yield path;
  }
}

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const dir of SCANNED) {
    for (const file of sources(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(pattern)) {
        const line = text.slice(0, match.index).split("\n").length;
        hits.push(`${file.slice(ROOT.length)}:${line} ${match[0]}`);
      }
    }
  }
  return hits;
}

// Colour comes from the semantic tokens in theme.css; a second palette is what erodes a system.
describe("app code uses semantic colour tokens only", () => {
  it("has no Tailwind palette classes", () => {
    expect(offenders(PALETTE_CLASS)).toEqual([]);
  });

  it("has no raw hex colours", () => {
    expect(offenders(RAW_HEX)).toEqual([]);
  });
});
