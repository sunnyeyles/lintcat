import { describe, expect, it } from "vitest";

import { buildRepositoryIndex } from "#src/build";
import {
  conventionCounts,
  conventionSentence,
  fileNameCasing,
  testFileNaming,
  type Convention,
  type ConventionCount,
} from "#src/conventions";

function indexOf(files: Record<string, string>) {
  return buildRepositoryIndex({ sha: "0".repeat(40), files: new Map(Object.entries(files)) });
}

/** Every file gets the same contents unless `files` names it. */
function tree(paths: readonly string[], contents = "export const x = 1;\n"): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [path, contents]));
}

function countOf(
  files: Record<string, string>,
  path: string,
  convention: Convention,
  changed: readonly string[] = [],
): ConventionCount | undefined {
  return conventionCounts(indexOf(files), path, new Set(changed)).find(
    (count) => count.convention === convention,
  );
}

describe("fileNameCasing", () => {
  it.each([
    ["src/credit-notes.ts", "kebab-case"],
    ["src/credit_notes.py", "snake_case"],
    ["src/creditNotes.ts", "camelCase"],
    ["src/CreditNotes.tsx", "PascalCase"],
    ["src/Slug.ts", "PascalCase"],
    ["docs/README.md", "UPPER_CASE"],
    ["src/credit-notes.test.ts", "kebab-case"],
    ["src/money.ts", undefined],
    ["app/[id]/page.tsx", undefined],
  ])("reads %s as %s", (path, casing) => {
    expect(fileNameCasing(path)).toBe(casing);
  });
});

describe("testFileNaming", () => {
  it.each([
    ["src/a.test.ts", "*.test.*"],
    ["src/a.spec.tsx", "*.spec.*"],
    ["pkg/a_test.go", "*_test.*"],
    ["app/test_a.py", "test_*.py"],
    ["evals/review.eval.ts", undefined],
    ["tests/helpers.ts", undefined],
  ])("reads %s as %s", (path, naming) => {
    expect(testFileNaming(path)).toBe(naming);
  });
});

describe("conventionCounts", () => {
  describe("file-name casing", () => {
    it("counts the siblings' casing", () => {
      const files = tree([
        "src/data/credit-notes.ts",
        "src/data/customer-accounts.ts",
        "src/data/payment-methods.ts",
        "src/data/tax-rates.ts",
        "src/data/invoice_lines.ts",
      ]);

      expect(countOf(files, "src/data/refundRequests.ts", "file-name-casing")).toEqual({
        convention: "file-name-casing",
        value: "kebab-case",
        count: 4,
        total: 5,
      });
    });

    it("leaves single-word names out of the total, since they fit every lowercase casing", () => {
      const files = tree([
        "src/data/credit-notes.ts",
        "src/data/customer-accounts.ts",
        "src/data/payment-methods.ts",
        "src/data/invoices.ts",
        "src/data/payments.ts",
      ]);

      expect(countOf(files, "src/data/refunds.ts", "file-name-casing")).toMatchObject({
        count: 3,
        total: 3,
      });
    });

    it("reports nothing without a strong majority", () => {
      const files = tree([
        "src/lib/Slug.ts",
        "src/lib/dateUtils.ts",
        "src/lib/id_generator.ts",
        "src/lib/number-format.ts",
      ]);

      expect(countOf(files, "src/lib/percent.ts", "file-name-casing")).toBeUndefined();
    });

    it("reports nothing from fewer than three measurable siblings", () => {
      const files = tree(["src/data/credit-notes.ts", "src/data/tax-rates.ts"]);

      expect(countOf(files, "src/data/refundRequests.ts", "file-name-casing")).toBeUndefined();
    });

    it("leaves out the files the pull request changes", () => {
      const files = tree([
        "src/data/credit-notes.ts",
        "src/data/customer-accounts.ts",
        "src/data/payment-methods.ts",
      ]);

      expect(
        countOf(files, "src/data/refundRequests.ts", "file-name-casing", ["src/data/credit-notes.ts"]),
      ).toBeUndefined();
    });
  });

  describe("test-file naming", () => {
    it("counts sibling tests by how they are named", () => {
      const files = tree([
        "src/a.test.ts",
        "src/b.test.ts",
        "src/c.test.ts",
        "src/d.test.ts",
        "src/a.ts",
      ]);

      expect(countOf(files, "src/e.spec.ts", "test-file-naming")).toEqual({
        convention: "test-file-naming",
        value: "*.test.*",
        count: 4,
        total: 4,
      });
    });

    it("says nothing about a source file, whose siblings are not tests", () => {
      const files = tree(["src/a.ts", "src/b.ts", "src/c.ts", "src/a.test.ts", "src/b.test.ts"]);

      expect(countOf(files, "src/d.ts", "test-file-naming")).toBeUndefined();
    });

    it("reports nothing when the tests are split between conventions", () => {
      const files = tree(["src/a.test.ts", "src/b.spec.ts", "src/c.test.ts", "src/d.spec.ts"]);

      expect(countOf(files, "src/e.test.ts", "test-file-naming")).toBeUndefined();
    });
  });

  describe("export style", () => {
    it("counts named-only modules", () => {
      const files = tree(["src/data/a.ts", "src/data/b.ts", "src/data/c.ts"]);

      expect(countOf(files, "src/data/d.ts", "export-style")).toEqual({
        convention: "export-style",
        value: "named",
        count: 3,
        total: 3,
      });
    });

    it("counts default exports, and leaves out a module exporting nothing", () => {
      const files = {
        ...tree(["src/pages/a.tsx", "src/pages/b.tsx", "src/pages/c.tsx", "src/pages/d.tsx"], "export default function Page() {}\n"),
        "src/pages/e.tsx": "export const helper = 1;\n",
        "src/pages/f.tsx": "run();\n",
      };

      expect(countOf(files, "src/pages/g.tsx", "export-style")).toMatchObject({
        value: "default",
        count: 4,
        total: 5,
      });
    });

    it("reports nothing for an even split", () => {
      const files = {
        ...tree(["src/a.ts", "src/b.ts"], "export default 1;\n"),
        ...tree(["src/c.ts", "src/d.ts"]),
      };

      expect(countOf(files, "src/e.ts", "export-style")).toBeUndefined();
    });
  });

  describe("import style", () => {
    const relative = 'import { money } from "../lib/money.js";\nexport const a = 1;\n';
    const extensionless = 'import { money } from "../lib/money";\nexport const a = 1;\n';

    it("counts relative imports written with an extension", () => {
      const files = {
        "src/lib/money.ts": "export const money = 1;\n",
        ...tree(["src/data/a.ts", "src/data/b.ts", "src/data/c.ts"], relative),
        "src/data/d.ts": extensionless,
      };
      const index = indexOf(files);
      const counts = conventionCounts(index, "src/data/e.ts", new Set());

      expect(counts.find((count) => count.convention === "import-path")).toEqual({
        convention: "import-path",
        value: "relative",
        count: 4,
        total: 4,
      });
      expect(counts.find((count) => count.convention === "import-extension")).toBeUndefined();
    });

    it("counts path-alias imports within the package", () => {
      const alias = 'import { money } from "#src/money";\nexport const a = 1;\n';
      const files = {
        "packages/core/package.json": JSON.stringify({
          name: "@acme/core",
          imports: { "#src/*": "./src/*.ts" },
        }),
        "packages/core/src/money.ts": "export const money = 1;\n",
        ...tree(
          ["packages/core/src/data/a.ts", "packages/core/src/data/b.ts", "packages/core/src/data/c.ts"],
          alias,
        ),
      };

      expect(countOf(files, "packages/core/src/data/d.ts", "import-path")).toMatchObject({
        value: "alias",
        count: 3,
      });
      expect(countOf(files, "packages/core/src/data/d.ts", "import-extension")).toMatchObject({
        value: "extensionless",
        count: 3,
      });
    });

    it("ignores third-party imports and counts a file mixing styles against any majority", () => {
      const mixed = 'import { money } from "../lib/money.js";\nimport { tax } from "../lib/tax";\n';
      const files = {
        "src/lib/money.ts": "export const money = 1;\n",
        "src/lib/tax.ts": "export const tax = 1;\n",
        ...tree(["src/data/a.ts", "src/data/b.ts"], `import { z } from "zod";\n${relative}`),
        "src/data/c.ts": mixed,
      };

      expect(countOf(files, "src/data/d.ts", "import-extension")).toBeUndefined();
    });
  });

  it("is empty in a directory with no convention at all", () => {
    const files = {
      "src/lib/Slug.ts": "export default function slug() {}\n",
      "src/lib/dateUtils.ts": "export const format = 1;\n",
      "src/lib/id_generator.ts": "module.exports = {};\n",
      "src/lib/money.ts": "export function money() {}\n",
    };

    expect(conventionCounts(indexOf(files), "src/lib/percent.ts", new Set())).toEqual([]);
  });
});

describe("conventionSentence", () => {
  it("says all when every sibling agrees, and n of m when not", () => {
    expect(
      conventionSentence({ convention: "file-name-casing", value: "kebab-case", count: 4, total: 4 }),
    ).toBe("all 4 siblings use kebab-case file names");
    expect(
      conventionSentence(
        { convention: "export-style", value: "named", count: 12, total: 14 },
        "siblings of src/data/a.ts",
      ),
    ).toBe("12 of 14 siblings of src/data/a.ts use named exports only");
  });
});
