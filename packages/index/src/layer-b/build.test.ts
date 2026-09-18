/** Layer B end to end: a real scip-typescript run over a tiny project. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LayerBIndex, SymbolRecord } from "../types.js";
import { buildLayerB } from "./build.js";

const A = `export function greet(name: string): string {
  return \`hi \${name}\`;
}

export class Greeter {
  greet(name: string): string {
    return greet(name);
  }
}
`;

const B = `import { greet, Greeter } from "./a.js";

export function run(): string {
  const greeter = new Greeter();
  return greet("x") + greet("y") + greeter.greet("z");
}
`;

const C = `export const alone = 1;
`;

let rootDir = "";
let index: LayerBIndex;

function symbolAt(file: string, name: string, kind: string): SymbolRecord {
  const found = index.symbols.find(
    (symbol) => symbol.file === file && symbol.name === name && symbol.kind === kind,
  );
  if (found === undefined) throw new Error(`no ${kind} ${name} in ${file}`);
  return found;
}

function linesOf(symbol: SymbolRecord, file: string): number[] {
  return index.references
    .filter((reference) => reference.symbol === symbol.id && reference.file === file)
    .map((reference) => reference.line)
    .sort((a, b) => a - b);
}

beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "layer-b-"));
  await writeFile(join(rootDir, "package.json"), '{ "name": "tiny", "version": "1.0.0" }\n');
  await writeFile(join(rootDir, "a.ts"), A);
  await writeFile(join(rootDir, "b.ts"), B);
  await writeFile(join(rootDir, "c.ts"), C);
  index = await buildLayerB(rootDir);
}, 120_000);

afterAll(async () => {
  if (rootDir !== "") await rm(rootDir, { recursive: true, force: true });
});

describe("buildLayerB", () => {
  it("records every definition with its kind, extent, and exported flag", () => {
    expect(symbolAt("a.ts", "greet", "function")).toMatchObject({
      line: 1,
      endLine: 3,
      exported: true,
    });
    expect(symbolAt("a.ts", "Greeter", "class")).toMatchObject({
      line: 5,
      exported: true,
    });
    expect(symbolAt("a.ts", "greet", "method")).toMatchObject({
      line: 6,
      exported: false,
    });
    expect(symbolAt("b.ts", "run", "function")).toMatchObject({ exported: true });
    expect(symbolAt("c.ts", "alone", "variable")).toMatchObject({
      line: 1,
      exported: true,
    });
  });

  it("resolves references across files, by line", () => {
    const greet = symbolAt("a.ts", "greet", "function");
    expect(linesOf(greet, "b.ts")).toEqual([1, 5, 5]);
    expect(linesOf(greet, "a.ts")).toEqual([7]);

    const greeter = symbolAt("a.ts", "Greeter", "class");
    expect(linesOf(greeter, "b.ts")).toEqual([1, 4]);
    expect(linesOf(symbolAt("a.ts", "greet", "method"), "b.ts")).toEqual([5]);
  });

  it("never records a reference inside the definition itself", () => {
    const alone = symbolAt("c.ts", "alone", "variable");
    expect(index.references.filter((reference) => reference.symbol === alone.id)).toEqual([]);
  });

  it("draws one import edge per importing file", () => {
    expect(index.imports).toEqual([{ from: "b.ts", to: "a.ts" }]);
  });

  it("reports full resolution for the files it saw", () => {
    expect(index.coverage).toEqual([
      { language: "typescript", files: 3, indexed: true, resolutionRate: 1 },
      { language: "javascript", files: 0, indexed: true, resolutionRate: 0 },
    ]);
  });

  it("throws with the failure when the indexer is not there", async () => {
    await expect(
      buildLayerB(rootDir, { scipTypescriptBin: join(rootDir, "missing.js") }),
    ).rejects.toThrow(/scip-typescript failed/);
  });

  it("does nothing for a language it has no indexer for", async () => {
    expect(await buildLayerB(rootDir, { languages: ["python"] })).toEqual({
      symbols: [],
      references: [],
      imports: [],
      coverage: [],
    });
  });
});
