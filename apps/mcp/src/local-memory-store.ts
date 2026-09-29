/** Review memory for a checkout with no memory branch; under .git, so no review reads it. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { StructuredLogger } from "@pr-review/logging";
import {
  addSuppression,
  MEMORY_FILE_PATH,
  readMemory,
  titleShape,
  writeMemory,
  type MemoryStore,
  type SuppressibleFinding,
} from "@pr-review/reviewer";

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

export interface RecordedSuppression {
  path: string;
  shape: string;
  suppressions: readonly { category: string; shape: string }[];
}

/** Marks findings shaped like this one as false positives in the checkout's memory. */
export async function recordSuppression(
  root: string,
  finding: SuppressibleFinding & { reason?: string | undefined },
  logger: StructuredLogger,
): Promise<RecordedSuppression> {
  const store = await openLocalMemoryStore(root);
  const memory = await readMemory(store, logger);
  const updated = addSuppression(memory, finding, new Date());
  await writeMemory(store, updated);
  const shape = titleShape(finding.title);
  logger.info("memory.suppression_recorded", { repoPath: root, category: finding.category, shape });
  return { path: store.path, shape, suppressions: updated.suppressions };
}
