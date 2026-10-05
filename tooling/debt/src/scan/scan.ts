import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { DebtConfig } from "#src/config";
import { matchesAny } from "#src/glob";
import { stripNonCode } from "#src/scan/strip";
import type { CategoryHits, PackageScan } from "#src/snapshot";
import type { Workspace } from "#src/workspaces";

const SOURCE = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", ".turbo", ".git"]);

function* sourceFiles(root: string, dir: string, exclude: string[]): Generator<string> {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(path.join(root, rel)).isDirectory()) {
      if (!matchesAny(`${rel}/`, exclude)) yield* sourceFiles(root, rel, exclude);
    } else if (SOURCE.test(entry) && !matchesAny(rel, exclude)) {
      yield rel;
    }
  }
}

function hits(): CategoryHits {
  return { count: 0, files: {} };
}

function add(category: CategoryHits, file: string, amount: number) {
  category.count += amount;
  category.files[file] = (category.files[file] ?? 0) + amount;
}

function hasSiblingTest(root: string, file: string): boolean {
  const base = file.replace(/\.(tsx?)$/, "");
  return ["ts", "tsx"].some((ext) => existsSync(path.join(root, `${base}.test.${ext}`)));
}

export function scanWorkspace(root: string, workspace: Workspace, config: DebtConfig): PackageScan {
  const isTest = new RegExp(config.testFilePattern);
  const categories: Record<string, CategoryHits> = {};
  for (const name of [...Object.keys(config.lineRules), ...Object.keys(config.fileRules)].sort()) {
    categories[name] = hits();
  }
  const longFile = config.fileRules["long-file"];
  const untested = config.fileRules["untested-module"];
  let files = 0;
  let lines = 0;

  for (const file of sourceFiles(root, workspace.dir, config.exclude)) {
    const text = readFileSync(path.join(root, file), "utf8");
    const lineCount = text.split("\n").length;
    const test = isTest.test(file);
    files++;
    lines += lineCount;

    const code = stripNonCode(text);
    for (const [name, rule] of Object.entries(config.lineRules)) {
      if (rule.excludeTests && test) continue;
      if (rule.excludePackages?.includes(workspace.name)) continue;
      const matches = (rule.scope === "code" ? code : text).match(new RegExp(rule.pattern, "g"));
      if (matches && matches.length > 0) add(categories[name]!, file, matches.length);
    }

    const limit = test ? longFile.maxTestLines : longFile.maxLines;
    if (lineCount > limit) {
      categories["long-file"]!.count++;
      categories["long-file"]!.files[file] = lineCount;
    }

    if (!test && !matchesAny(file, untested.exclude) && !hasSiblingTest(root, file)) {
      add(categories["untested-module"]!, file, 1);
    }
  }
  return { files, lines, categories };
}
