import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import { siblingsOf } from "#src/siblings";

const index = buildRepositoryIndex({
  sha: "0".repeat(40),
  files: new Map(
    [
      "src/data/customers.ts",
      "src/data/invoices.ts",
      "src/data/invoices.test.ts",
      "src/data/legacy.js",
      "src/data/payments.ts",
      "src/data/README.md",
      "src/data/nested/deep.ts",
      "src/services/invoices.ts",
    ].map((path) => [path, "export {};\n"]),
  ),
});

function paths(path: string, changed: readonly string[] = []): string[] {
  return siblingsOf(index, path, new Set(changed)).map((file) => file.path);
}

describe("siblingsOf", () => {
  it("lists the files in the same directory with the same role, its own language first", () => {
    expect(paths("src/data/invoices.ts")).toEqual([
      "src/data/customers.ts",
      "src/data/payments.ts",
      "src/data/legacy.js",
    ]);
  });

  it("leaves out files the pull request changes", () => {
    expect(paths("src/data/invoices.ts", ["src/data/payments.ts"])).toEqual([
      "src/data/customers.ts",
      "src/data/legacy.js",
    ]);
  });

  it("classifies a file the index has never seen, such as an addition, by its path", () => {
    expect(paths("src/data/refunds.ts")).toEqual([
      "src/data/customers.ts",
      "src/data/invoices.ts",
      "src/data/payments.ts",
      "src/data/legacy.js",
    ]);
    expect(paths("src/data/refunds.test.ts")).toEqual(["src/data/invoices.test.ts"]);
  });

  it("is empty when nothing else in the directory plays the role", () => {
    expect(paths("src/services/invoices.ts")).toEqual([]);
    expect(paths("src/data/nested/deep.ts")).toEqual([]);
  });
});
