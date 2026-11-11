/** Targeted locate for small tasks: git grep for the spec's words, never a whole-repo scan. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Spec } from "#src/contract";

const run = promisify(execFile);

const STOPWORDS = new Set(
  "a an and the this that with from into when then given should must have has add adds make makes use uses user users new file files code test tests for not are was were will can".split(
    " ",
  ),
);

export interface LocateResult {
  keywords: string[];
  files: { path: string; hits: number }[];
}

function keywordsOf(spec: Spec, limit = 8): string[] {
  const text = [spec.title, spec.objective, ...spec.requirements, ...spec.plan].join(" ");
  const counts = new Map<string, number>();
  for (const word of text.match(/[A-Za-z_][A-Za-z0-9_-]{3,}/g) ?? []) {
    const key = word.toLowerCase();
    if (STOPWORDS.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([word]) => word);
}

/** Paths the spec names explicitly come first; then files by keyword hits. */
export async function locate(worktree: string, spec: Spec, maxFiles = 15): Promise<LocateResult> {
  const keywords = keywordsOf(spec);
  const scores = new Map<string, number>();
  const named = [...spec.plan, ...spec.architectureDecisions, ...spec.repositoryFindings]
    .join(" ")
    .match(/[\w./-]+\.[a-z]{1,5}\b/g);
  const { stdout: tracked } = await run("git", ["-C", worktree, "ls-files"], { maxBuffer: 64 * 1024 * 1024 });
  const trackedSet = new Set(tracked.split("\n"));
  for (const path of named ?? []) if (trackedSet.has(path)) scores.set(path, 1000);

  for (const keyword of keywords) {
    try {
      const { stdout } = await run("git", ["-C", worktree, "grep", "-c", "-i", "-I", "-F", "-e", keyword], {
        maxBuffer: 16 * 1024 * 1024,
      });
      for (const line of stdout.split("\n")) {
        const at = line.lastIndexOf(":");
        if (at <= 0) continue;
        const path = line.slice(0, at);
        scores.set(path, (scores.get(path) ?? 0) + Number(line.slice(at + 1)));
      }
    } catch {
      // git grep exits 1 when nothing matches.
    }
  }
  const files = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxFiles)
    .map(([path, hits]) => ({ path, hits }));
  return { keywords, files };
}
