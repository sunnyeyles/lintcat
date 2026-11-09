import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import { parseRun, type RunFile } from "@/lib/run-trace/parse-run";
import type { RunTrace } from "@/lib/run-trace/types";

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return Promise.resolve(/\.(jsonl|json)$/.test(entry.name) ? [path] : []);
    }),
  );
  return nested.flat();
}

/**
 * Reads a run from `<project>/<session>.jsonl` or its `<project>/<session>/` directory,
 * or any directory holding a main `.jsonl` beside `subagents/`.
 */
async function loadRunFiles(path: string): Promise<RunFile[]> {
  const info = await stat(path);
  let mainPath: string | undefined;
  let sessionDir: string;

  if (info.isFile()) {
    mainPath = path;
    sessionDir = path.replace(/\.jsonl$/, "");
  } else {
    sessionDir = path;
    const sibling = `${path.replace(/[\\/]$/, "")}.jsonl`;
    if (await exists(sibling)) mainPath = sibling;
  }

  const found = (await exists(sessionDir)) ? await walk(sessionDir) : [];
  const paths = found.filter((file) => file.includes("subagents") || (!mainPath && file.endsWith(".jsonl")));
  const files = await Promise.all(
    paths.map(async (file) => ({ name: relative(sessionDir, file), text: await readFile(file, "utf8") })),
  );
  if (mainPath) {
    files.push({ name: basename(mainPath), text: await readFile(mainPath, "utf8") });
  }
  return files.map((file) => ({ ...file, name: file.name.split("\\").join("/") }));
}

export async function loadRunDir(path: string): Promise<RunTrace> {
  return parseRun(await loadRunFiles(path));
}
