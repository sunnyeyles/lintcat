import { describe, expect, it } from "vitest";

import { addedFileDiff, parseUnifiedDiff } from "#src/unified-diff";

const encode = (text: string) => new TextEncoder().encode(text);

describe("addedFileDiff", () => {
  it("parses back into an added file with every line added", () => {
    expect(parseUnifiedDiff(addedFileDiff("src/new.ts", encode("a\nb\n")))).toEqual([
      { filename: "src/new.ts", status: "added", additions: 2, deletions: 0, patch: "@@ -0,0 +1,2 @@\n+a\n+b" },
    ]);
  });

  it("marks a missing final newline as git does", () => {
    expect(addedFileDiff("x", encode("a"))).toContain("@@ -0,0 +1 @@\n+a\n\\ No newline at end of file\n");
  });

  it("gives an empty file no hunk and a binary file no patch", () => {
    expect(parseUnifiedDiff(addedFileDiff("empty", encode("")) + addedFileDiff("logo.png", new Uint8Array([0, 1])))).toEqual([
      { filename: "empty", status: "added", additions: 0, deletions: 0 },
      { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
    ]);
  });
});

const diff = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
diff --git a/src/new file.ts b/src/new file.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new file.ts\t
@@ -0,0 +1 @@
+export {};
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-export {};
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..5555555
Binary files /dev/null and b/logo.png differ
diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`;

describe("parseUnifiedDiff", () => {
  it("splits a diff into GitHub-shaped changed files", () => {
    expect(parseUnifiedDiff(diff)).toEqual([
      {
        filename: "src/a.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        patch: "@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n+const c = 4;",
      },
      {
        filename: "src/new file.ts",
        status: "added",
        additions: 1,
        deletions: 0,
        patch: "@@ -0,0 +1 @@\n+export {};",
      },
      {
        filename: "src/gone.ts",
        status: "removed",
        additions: 0,
        deletions: 1,
        patch: "@@ -1 +0,0 @@\n-export {};",
      },
      { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
      { filename: "run.sh", status: "modified", additions: 0, deletions: 0 },
    ]);
  });

  it("returns nothing for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});

const lines = (...text: string[]) => `${text.join("\n")}\n`;

describe("parseUnifiedDiff on renames and copies", () => {
  it("keeps a pure rename, which has no hunk, under its new path", () => {
    const pure = lines(
      "diff --git a/src/util.ts b/src/lib/util.ts",
      "similarity index 100%",
      "rename from src/util.ts",
      "rename to src/lib/util.ts",
    );
    expect(parseUnifiedDiff(pure)).toEqual([
      { filename: "src/lib/util.ts", status: "renamed", previous_filename: "src/util.ts", additions: 0, deletions: 0 },
    ]);
  });

  it("counts the edits of a rename against its new path", () => {
    const edited = lines(
      "diff --git a/old name.ts b/new name.ts",
      "similarity index 87%",
      "rename from old name.ts",
      "rename to new name.ts",
      "index 3423bfd..2bf9375 100644",
      "--- a/old name.ts\t",
      "+++ b/new name.ts\t",
      "@@ -4,3 +4,3 @@ q1",
      " q4",
      "-q5",
      "+Q5",
      " q6",
    );
    expect(parseUnifiedDiff(edited)).toEqual([
      {
        filename: "new name.ts",
        status: "renamed",
        previous_filename: "old name.ts",
        additions: 1,
        deletions: 1,
        patch: "@@ -4,3 +4,3 @@ q1\n q4\n-q5\n+Q5\n q6",
      },
    ]);
  });

  it("names a rename from its headers when the diff --git line cannot be split", () => {
    const ambiguous = lines(
      "diff --git a/x b/y b/z",
      "old mode 100644",
      "new mode 100755",
      "similarity index 100%",
      "rename from x b/y",
      "rename to z",
    );
    expect(parseUnifiedDiff(ambiguous)).toEqual([
      { filename: "z", status: "renamed", previous_filename: "x b/y", additions: 0, deletions: 0 },
    ]);
  });

  it("reads a rename from the diff --git line alone", () => {
    expect(parseUnifiedDiff(lines("diff --git a/src/a.ts b/src/b.ts"))).toEqual([
      { filename: "src/b.ts", status: "renamed", previous_filename: "src/a.ts", additions: 0, deletions: 0 },
    ]);
  });

  it("gives a binary rename no patch", () => {
    const binary = lines(
      "diff --git a/img.png b/img2.png",
      "similarity index 99%",
      "rename from img.png",
      "rename to img2.png",
      "index a74028f..37ad944 100644",
      "Binary files a/img.png and b/img2.png differ",
    );
    expect(parseUnifiedDiff(binary)).toEqual([
      { filename: "img2.png", status: "renamed", previous_filename: "img.png", additions: 0, deletions: 0 },
    ]);
  });

  it("treats a copy as a change to the new path, leaving the source out", () => {
    const copy = lines(
      "diff --git a/src.ts b/copy.ts",
      "similarity index 87%",
      "copy from src.ts",
      "copy to copy.ts",
      "index 9caeabe..c330dae 100644",
      "--- a/src.ts",
      "+++ b/copy.ts",
      "@@ -8 +8 @@ c7",
      "-c8",
      "+C8",
    );
    expect(parseUnifiedDiff(copy)).toEqual([
      { filename: "copy.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -8 +8 @@ c7\n-c8\n+C8" },
    ]);
  });
});

describe("parseUnifiedDiff on C-quoted paths", () => {
  it("unquotes escapes and decodes octal bytes as UTF-8", () => {
    const quoted = lines(
      'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251 2.ts"',
      "similarity index 87%",
      'rename from "caf\\303\\251.ts"',
      'rename to "caf\\303\\251 2.ts"',
      "index cc0b978..1511c40 100644",
      '--- "a/caf\\303\\251.ts"',
      '+++ "b/caf\\303\\251 2.ts"\t',
      "@@ -5 +5 @@ u4",
      "-u5",
      "+U5",
      'diff --git "a/tab\\there.ts" "b/tab\\tthere.ts"',
      "similarity index 100%",
      'rename from "tab\\there.ts"',
      'rename to "tab\\tthere.ts"',
      'diff --git "a/quo\\"te.ts" b/quote.ts',
      "similarity index 100%",
      'rename from "quo\\"te.ts"',
      "rename to quote.ts",
    );
    expect(parseUnifiedDiff(quoted)).toEqual([
      {
        filename: "café 2.ts",
        status: "renamed",
        previous_filename: "café.ts",
        additions: 1,
        deletions: 1,
        patch: "@@ -5 +5 @@ u4\n-u5\n+U5",
      },
      { filename: "tab\tthere.ts", status: "renamed", previous_filename: "tab\there.ts", additions: 0, deletions: 0 },
      { filename: "quote.ts", status: "renamed", previous_filename: 'quo"te.ts', additions: 0, deletions: 0 },
    ]);
  });

  it("names a quoted file whose only change is its mode", () => {
    const mode = lines('diff --git "a/back\\\\slash.sh" "b/back\\\\slash.sh"', "old mode 100644", "new mode 100755");
    expect(parseUnifiedDiff(mode)).toEqual([
      { filename: "back\\slash.sh", status: "modified", additions: 0, deletions: 0 },
    ]);
  });

  it("names a quoted added and deleted file", () => {
    const addedAndGone = lines(
      'diff --git "a/new\\tfile.ts" "b/new\\tfile.ts"',
      "new file mode 100644",
      "--- /dev/null",
      '+++ "b/new\\tfile.ts"',
      "@@ -0,0 +1 @@",
      "+export {};",
      'diff --git "a/gone\\\\.ts" "b/gone\\\\.ts"',
      "deleted file mode 100644",
      "Binary files \"a/gone\\\\.ts\" and /dev/null differ",
    );
    expect(parseUnifiedDiff(addedAndGone)).toEqual([
      { filename: "new\tfile.ts", status: "added", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+export {};" },
      { filename: "gone\\.ts", status: "removed", additions: 0, deletions: 0 },
    ]);
  });
});
