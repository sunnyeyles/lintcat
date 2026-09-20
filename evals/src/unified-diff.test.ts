/** Diff construction, checked by reading the hunks and by replaying them. */
import { describe, expect, it } from "vitest";

import { buildFileDiff, buildPatch } from "#src/unified-diff";

const HUNK_HEADER = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/;

function toLines(text: string): string[] {
  return text === "" ? [] : text.slice(0, -1).split("\n");
}

function fromLines(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/**
 * Replays a patch onto the base file, asserting every header line number
 * and count on the way. A shifted hunk cannot survive this.
 */
function applyPatch(baseText: string, patch: string): string {
  const baseLines = toLines(baseText);
  const out: string[] = [];
  let cursor = 0;
  let pending: { baseCount: number; headCount: number } | undefined;
  const closeHunk = (): void => {
    if (pending !== undefined) {
      expect(pending).toEqual({ baseCount: 0, headCount: 0 });
    }
  };

  for (const line of patch === "" ? [] : patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      closeHunk();
      const [baseStart, baseCount, headStart, headCount] = header
        .slice(1)
        .map(Number) as [number, number, number, number];
      const from = baseStart === 0 ? 0 : baseStart - 1;
      expect(from).toBeGreaterThanOrEqual(cursor);
      out.push(...baseLines.slice(cursor, from));
      cursor = from;
      expect(out.length).toBe(headStart === 0 ? 0 : headStart - 1);
      pending = { baseCount, headCount };
      continue;
    }
    expect(pending).toBeDefined();
    const text = line.slice(1);
    if (line.startsWith("+")) {
      out.push(text);
      pending = { ...pending!, headCount: pending!.headCount - 1 };
      continue;
    }
    expect(baseLines[cursor]).toBe(text);
    cursor += 1;
    if (line.startsWith(" ")) {
      out.push(text);
      pending = {
        baseCount: pending!.baseCount - 1,
        headCount: pending!.headCount - 1,
      };
    } else {
      expect(line.startsWith("-")).toBe(true);
      pending = { ...pending!, baseCount: pending!.baseCount - 1 };
    }
  }
  closeHunk();
  out.push(...baseLines.slice(cursor));
  return fromLines(out);
}

const TEN = fromLines(
  Array.from({ length: 10 }, (_unused, index) => `line ${index + 1}`),
);

describe("buildPatch", () => {
  it("writes a whole-file addition against an empty old side", () => {
    expect(buildPatch(undefined, "alpha\nbeta\n", "src/new.ts")).toBe(
      ["@@ -0,0 +1,2 @@", "+alpha", "+beta"].join("\n"),
    );
  });

  it("writes a whole-file removal against an empty new side", () => {
    expect(buildPatch("alpha\nbeta\n", "", "src/gone.ts")).toBe(
      ["@@ -1,2 +0,0 @@", "-alpha", "-beta"].join("\n"),
    );
  });

  it("surrounds a modified line with three lines of context", () => {
    const head = TEN.replace("line 5\n", "line 5 changed\n");
    expect(buildPatch(TEN, head, "src/mid.ts")).toBe(
      [
        "@@ -2,7 +2,7 @@",
        " line 2",
        " line 3",
        " line 4",
        "-line 5",
        "+line 5 changed",
        " line 6",
        " line 7",
        " line 8",
      ].join("\n"),
    );
  });

  it("clamps context at the start and end of the file", () => {
    const head = TEN.replace("line 1\n", "line 1 changed\n").replace(
      "line 10\n",
      "line 10 changed\n",
    );
    const patch = buildPatch(TEN, head, "src/edges.ts");
    expect(patch.split("\n").filter((line) => HUNK_HEADER.test(line))).toEqual([
      "@@ -1,4 +1,4 @@",
      "@@ -7,4 +7,4 @@",
    ]);
    expect(applyPatch(TEN, patch)).toBe(head);
  });

  it("joins changes closer than twice the context window into one hunk", () => {
    const head = TEN.replace("line 3\n", "line 3 changed\n").replace(
      "line 8\n",
      "line 8 changed\n",
    );
    const patch = buildPatch(TEN, head, "src/near.ts");
    expect(patch.split("\n").filter((line) => HUNK_HEADER.test(line))).toHaveLength(1);
    expect(applyPatch(TEN, patch)).toBe(head);
  });

  it("produces an empty patch when nothing changed", () => {
    expect(buildPatch(TEN, TEN, "src/same.ts")).toBe("");
  });

  it("handles a blank line being removed", () => {
    const base = "alpha\n\nbeta\n";
    const head = "alpha\nbeta\n";
    const patch = buildPatch(base, head, "src/blank.ts");
    expect(patch.split("\n")).toContain("-");
    expect(applyPatch(base, patch)).toBe(head);
  });

  it.each([
    ["the new side", "alpha\n", "alpha\nbeta"],
    ["the old side", "alpha", "alpha\nbeta\n"],
  ])("rejects a fixture file with no trailing newline on %s", (_label, base, head) => {
    expect(() => buildPatch(base, head, "src/unterminated.ts")).toThrow(
      /src\/unterminated\.ts does not end with a newline/,
    );
  });
});

describe("buildFileDiff", () => {
  it("marks an added file with /dev/null and a null blob", () => {
    const diff = buildFileDiff("src/new.ts", undefined, "alpha\n").split("\n");
    expect(diff.slice(0, 5)).toEqual([
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 0000000..4a58007",
      "--- /dev/null",
      "+++ b/src/new.ts",
    ]);
  });

  it("names both blobs and the mode for a modified file", () => {
    const diff = buildFileDiff("src/mid.ts", "alpha\n", "beta\n").split("\n");
    expect(diff.slice(0, 4)).toEqual([
      "diff --git a/src/mid.ts b/src/mid.ts",
      "index 4a58007..65b2df8 100644",
      "--- a/src/mid.ts",
      "+++ b/src/mid.ts",
    ]);
  });

  it("uses the blob SHA git itself computes", () => {
    // `printf 'alpha\n' | git hash-object --stdin`
    expect(buildFileDiff("f.ts", undefined, "alpha\n")).toContain(
      "index 0000000..4a58007",
    );
  });

  it("carries the patch after the headers", () => {
    const diff = buildFileDiff("src/mid.ts", TEN, TEN.replace("line 5\n", "x\n"));
    expect(diff).toContain("@@ -2,7 +2,7 @@");
    expect(applyPatch(TEN, diff.split("\n").slice(4).join("\n"))).toBe(
      TEN.replace("line 5\n", "x\n"),
    );
  });
});
