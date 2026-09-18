/** SCIP symbol strings: names, kinds, the exported rule, and what is skipped. */
import { describe, expect, it } from "vitest";

import { parseScipSymbol, symbolKind } from "./symbols.js";

const PREFIX = "scip-typescript npm tiny 1.0.0 ";

function parse(descriptors: string) {
  const parsed = parseScipSymbol(`${PREFIX}${descriptors}`);
  if (parsed === undefined) throw new Error(`did not parse: ${descriptors}`);
  return parsed;
}

function kindOf(descriptors: string, informationKind?: string) {
  return symbolKind(parse(descriptors).descriptors, informationKind);
}

describe("parseScipSymbol", () => {
  it("names a symbol after its last descriptor", () => {
    expect(parse("`a.ts`/greet().").name).toBe("greet");
    expect(parse("`a.ts`/Greeter#greet().").name).toBe("greet");
    expect(parse("`a.ts`/Greeter#").name).toBe("Greeter");
    expect(parse("`a.ts`/unused.").name).toBe("unused");
    expect(parse("`a.ts`/").name).toBe("a.ts");
  });

  it("reads a method disambiguator and a parameter", () => {
    expect(parse("`a.ts`/greet(+1).").name).toBe("greet");
    expect(parse("`a.ts`/greet().(name)").name).toBe("name");
    expect(parse("`a.ts`/Box#[T]").name).toBe("T");
  });

  it("keeps escaped identifiers and escaped spaces apart", () => {
    expect(parse("`src/a.ts`/x.").name).toBe("x");
    expect(parseScipSymbol("scip-typescript npm my  pkg 1.0.0 `a.ts`/x.")?.name).toBe("x");
    expect(parse("`a``b`/x.").descriptors[0]?.name).toBe("a`b");
  });

  it("skips locals and anything that does not parse", () => {
    expect(parseScipSymbol("local 2")).toBeUndefined();
    expect(parseScipSymbol("scip-typescript npm tiny 1.0.0 ")).toBeUndefined();
    expect(parseScipSymbol("not a symbol")).toBeUndefined();
    expect(parseScipSymbol(`${PREFIX}\`unterminated`)).toBeUndefined();
    expect(parseScipSymbol(`${PREFIX}greet`)).toBeUndefined();
  });

  it("exports only what is top level in its file", () => {
    expect(parse("`a.ts`/greet().").exported).toBe(true);
    expect(parse("`a.ts`/Greeter#").exported).toBe(true);
    expect(parse("src/`a.ts`/greet().").exported).toBe(true);
    expect(parse("`a.ts`/Greeter#greet().").exported).toBe(false);
    expect(parse("`a.ts`/greet().(name)").exported).toBe(false);
    expect(parse("`a.ts`/").exported).toBe(false);
  });
});

describe("symbolKind", () => {
  it("reads the kind off the last descriptor's suffix", () => {
    expect(kindOf("`a.ts`/greet().")).toBe("function");
    expect(kindOf("`a.ts`/Greeter#greet().")).toBe("method");
    expect(kindOf("`a.ts`/Greeter#")).toBe("class");
    expect(kindOf("`a.ts`/unused.")).toBe("variable");
    expect(kindOf("`a.ts`/Greeter#size.")).toBe("property");
    expect(kindOf("`a.ts`/")).toBe("module");
    expect(kindOf("`a.ts`/greet().(name)")).toBe("unknown");
  });

  it("refines a type descriptor with SymbolInformation.kind", () => {
    expect(kindOf("`a.ts`/Shape#", "Interface")).toBe("interface");
    expect(kindOf("`a.ts`/Shape#", "TypeAlias")).toBe("type");
    expect(kindOf("`a.ts`/Shape#", "Enum")).toBe("enum");
    expect(kindOf("`a.ts`/Shape#", "Class")).toBe("class");
    expect(kindOf("`a.ts`/Shape#", "Struct")).toBe("class");
  });
});
