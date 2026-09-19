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
