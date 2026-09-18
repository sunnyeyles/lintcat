/**
 * A FileSource over a directory on disk, for the CLI and for tests that index
 * this repository. `.git` and `node_modules` are skipped at any depth.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { FileSource } from "./types.js";

/** Past this many files the listing is cut short and reported as truncated. */
export const MAX_LOCAL_FILES = 200_000;

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

const MISSING_ERRORS = new Set(["ENOENT", "EISDIR", "ENOTDIR", "EACCES"]);

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

async function walk(
  rootDir: string,
  relative: string,
  found: string[],
): Promise<boolean> {
  const entries = await readdir(join(rootDir, relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      if (await walk(rootDir, path, found)) return true;
      continue;
    }
    if (!entry.isFile()) continue;
    if (found.length >= MAX_LOCAL_FILES) return true;
    found.push(path);
  }
  return false;
}

export function createLocalFileSource(rootDir: string, sha: string): FileSource {
  return {
    sha,
    async listPaths() {
      const found: string[] = [];
      const truncated = await walk(rootDir, "", found);
      return { paths: found.sort(), truncated };
    },
    async read(path: string) {
      try {
        return await readFile(join(rootDir, path), "utf8");
      } catch (error: unknown) {
        const code = errorCode(error);
        if (code !== undefined && MISSING_ERRORS.has(code)) return undefined;
        throw error;
      }
    },
  };
}
