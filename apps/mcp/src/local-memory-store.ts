/** Review memory for a checkout with no memory branch; under .git, so no review reads it. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MEMORY_FILE_PATH, type MemoryStore } from "@pr-review/reviewer";

import { git } from "#src/git";

const MEMORY_DIR = "pr-review-agents";

/** Where a checkout keeps its memory; the directory is made on first write. */
async function localMemoryPath(root: string): Promise<string> {
  const gitDir = (await git(root, ["rev-parse", "--absolute-git-dir"])).trim();
  return path.join(gitDir, MEMORY_DIR, MEMORY_FILE_PATH);
}

export interface LocalMemoryStore extends MemoryStore {
  /** The file behind the store, so a tool can tell the user where it went. */
  path: string;
}

export async function openLocalMemoryStore(
  root: string,
): Promise<LocalMemoryStore> {
  const file = await localMemoryPath(root);
  return {
    path: file,
    read() {
      try {
        return Promise.resolve(readFileSync(file, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return Promise.resolve(undefined);
        }
        return Promise.reject(error as Error);
      }
    },
    write(content) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content, "utf8");
      return Promise.resolve();
    },
  };
}
