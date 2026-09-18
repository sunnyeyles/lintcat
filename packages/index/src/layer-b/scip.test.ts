/** Decoding, over a message encoded with the same vendored schema. */
import { describe, expect, it } from "vitest";

import { decodeScipIndex, scipRoot } from "./scip.js";

function encode(index: Record<string, unknown>): Uint8Array {
  const type = scipRoot().lookupType("scip.Index");
  return type.encode(type.create(index)).finish();
}

const INDEX = {
  documents: [
    {
      relativePath: "a.ts",
      language: "TypeScript",
      occurrences: [
        { symbol: "one", range: [0, 4, 9], symbolRoles: 1, enclosingRange: [0, 0, 2, 1] },
        { symbol: "two", range: [3, 0, 5, 1] },
        {
          symbol: "three",
          singleLineRange: { line: 7, startCharacter: 2, endCharacter: 6 },
          symbolRoles: 2,
        },
        {
          symbol: "four",
          multiLineRange: { startLine: 9, startCharacter: 0, endLine: 11, endCharacter: 3 },
        },
        { symbol: "no range" },
        { range: [1, 1, 2] },
      ],
      symbols: [
        { symbol: "one", kind: 17, displayName: "one" },
        { symbol: "two" },
      ],
    },
  ],
};

describe("decodeScipIndex", () => {
  const [document] = decodeScipIndex(encode(INDEX)).documents;
  const occurrences = document?.occurrences ?? [];

  it("keeps the document's path and language", () => {
    expect(document?.relativePath).toBe("a.ts");
    expect(document?.language).toBe("TypeScript");
  });

  it("makes lines one-based from a three-element range", () => {
    expect(occurrences[0]).toEqual({
      symbol: "one",
      roles: 1,
      range: { startLine: 1, startChar: 4, endLine: 1, endChar: 9 },
      enclosingRange: { startLine: 1, startChar: 0, endLine: 3, endChar: 1 },
    });
  });

  it("reads four-element and typed ranges", () => {
    expect(occurrences[1]?.range).toEqual({
      startLine: 4,
      startChar: 0,
      endLine: 6,
      endChar: 1,
    });
    expect(occurrences[2]?.range).toEqual({
      startLine: 8,
      startChar: 2,
      endLine: 8,
      endChar: 6,
    });
    expect(occurrences[2]?.roles).toBe(2);
    expect(occurrences[3]?.range).toEqual({
      startLine: 10,
      startChar: 0,
      endLine: 12,
      endChar: 3,
    });
  });

  it("drops an occurrence with no symbol or no range", () => {
    expect(occurrences).toHaveLength(4);
  });

  it("names the symbol kind and leaves an unspecified one out", () => {
    expect(document?.symbols).toEqual([
      { symbol: "one", kind: "Function", displayName: "one" },
      { symbol: "two", kind: undefined, displayName: undefined },
    ]);
  });

  it("returns no documents for an empty index", () => {
    expect(decodeScipIndex(encode({})).documents).toEqual([]);
  });
});
