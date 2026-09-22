import type { ChangedFile } from "@pr-review/github";
import { describe, expect, it } from "vitest";

import { buildOpeningDiff, renderOmitted } from "#src/agents/opening-diff";

function changed(filename: string, patch?: string): ChangedFile {
  return {
    filename,
    status: "modified",
    additions: 1,
    deletions: 0,
    ...(patch === undefined ? {} : { patch }),
  };
}

const source = changed("src/app.ts", "@@ -1 +1 @@\n-a\n+b");

describe("buildOpeningDiff", () => {
  it("renders each patch under the unified-diff header lines", () => {
    const { diff, omitted } = buildOpeningDiff([source]);

    expect(diff).toBe(
      "diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-a\n+b",
    );
    expect(omitted).toEqual([]);
  });

  it.each([
    ["pnpm-lock.yaml", "generated"],
    ["package-lock.json", "generated"],
    ["dist/bundle.js", "generated"],
    ["src/types.d.ts", "generated"],
    ["public/app.min.js", "generated"],
    ["vendor/lib/x.go", "vendored"],
    ["node_modules/x/index.js", "vendored"],
  ])("omits %s as %s", (filename, reason) => {
    const { diff, omitted } = buildOpeningDiff([changed(filename, "+x"), source]);

    expect(omitted).toEqual([{ filename, reason }]);
    expect(diff).not.toContain(filename);
    expect(diff).toContain("src/app.ts");
  });

  it("omits a file without a patch as binary", () => {
    const { diff, omitted } = buildOpeningDiff([changed("logo.png"), source]);

    expect(omitted).toEqual([{ filename: "logo.png", reason: "binary" }]);
    expect(diff).not.toContain("logo.png");
  });

  it("cuts one oversized patch on a line boundary and says how to get the rest", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `+line ${i}`);
    const big = changed("src/big.ts", lines.join("\n"));

    const { diff, omitted } = buildOpeningDiff([big], { maxChars: 10_000, maxFileChars: 100 });

    expect(omitted).toEqual([]);
    expect(diff).toContain("[... patch truncated; get_diff with this path returns it whole]");
    const kept = diff.split("\n[...")[0]?.split("\n").slice(3) ?? [];
    expect(kept.every((line) => /^\+line \d+$/.test(line))).toBe(true);
    expect(kept.length).toBeGreaterThan(0);
  });

  it("stops at the budget, keeping earlier files whole and naming the rest", () => {
    const first = changed("src/first.ts", "+".repeat(60));
    const second = changed("src/second.ts", "+".repeat(60));
    const third = changed("src/third.ts", "+");

    const { diff, omitted } = buildOpeningDiff([first, second, third], {
      maxChars: 150,
      maxFileChars: 1_000,
    });

    expect(diff).toContain("src/first.ts");
    expect(diff).toContain("+".repeat(60));
    expect(diff).not.toContain("src/second.ts");
    expect(omitted).toEqual([
      { filename: "src/second.ts", reason: "over budget" },
      { filename: "src/third.ts", reason: "over budget" },
    ]);
  });

  it("keeps changed-file order", () => {
    const { diff } = buildOpeningDiff([
      changed("src/z.ts", "+z"),
      changed("src/a.ts", "+a"),
    ]);

    expect(diff.indexOf("src/z.ts")).toBeLessThan(diff.indexOf("src/a.ts"));
  });
});

describe("renderOmitted", () => {
  it("renders nothing when nothing was omitted", () => {
    expect(renderOmitted([])).toEqual([]);
  });

  it("names each omitted file with its reason", () => {
    const [line] = renderOmitted([
      { filename: "pnpm-lock.yaml", reason: "generated" },
      { filename: "logo.png", reason: "binary" },
    ]);

    expect(line).toContain("pnpm-lock.yaml (generated), logo.png (binary)");
    expect(line).toContain("get_diff");
  });

  it("names at most thirty files and counts the rest", () => {
    const many = Array.from({ length: 33 }, (_, i) => ({
      filename: `gen/${i}.ts`,
      reason: "generated" as const,
    }));

    const [line] = renderOmitted(many);

    expect(line).toContain("gen/29.ts (generated)");
    expect(line).not.toContain("gen/30.ts");
    expect(line).toContain(", and 3 more");
  });
});
