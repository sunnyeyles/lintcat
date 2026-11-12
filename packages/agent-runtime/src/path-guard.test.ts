import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { checkToolPath } from "#src/path-guard";

describe("checkToolPath", () => {
  const base = mkdtempSync(path.join(tmpdir(), "guard-"));
  const root = path.join(base, "root");
  mkdirSync(path.join(root, "src"), { recursive: true });
  symlinkSync(base, path.join(root, "escape"));

  it("allows paths inside the root, including files not yet created", () => {
    expect(checkToolPath(root, { file_path: "src/a.ts" })).toBeNull();
    expect(checkToolPath(root, { file_path: path.join(root, "new/dir/b.ts") })).toBeNull();
    expect(checkToolPath(root, { pattern: "*.ts" })).toBeNull();
  });

  it("denies traversal, absolute escapes, symlink escapes and .git", () => {
    expect(checkToolPath(root, { file_path: "../outside" })).toMatch(/outside/);
    expect(checkToolPath(root, { path: "/etc" })).toMatch(/outside/);
    expect(checkToolPath(root, { file_path: "escape/root2" })).toMatch(/outside/);
    expect(checkToolPath(root, { file_path: ".git" })).toMatch(/\.git/);
  });
});
