/** The last local review, kept under the git directory so a repeat over the same inputs is free. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { git } from "@pr-review/mcp/local-review";
import { localReviewReportSchema, type LocalReviewReport } from "@pr-review/schemas";

const CACHE_FILE = path.join("pr-review-agents", "last-review.json");

export interface CachedReview {
  /** Everything the report depends on, serialised; a hit needs an exact match. */
  key: string;
  report: LocalReviewReport;
}

export async function reviewCachePath(root: string): Promise<string> {
  const gitDir = (await git(root, ["rev-parse", "--absolute-git-dir"])).trim();
  return path.join(gitDir, CACHE_FILE);
}

/** Undefined for a missing, unreadable or outdated file: the cache is only ever a shortcut. */
export function readLastReview(file: string): CachedReview | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const { key, report } = raw as Record<string, unknown>;
  const parsed = localReviewReportSchema.safeParse(report);
  return typeof key === "string" && parsed.success ? { key, report: parsed.data } : undefined;
}

export function writeLastReview(file: string, review: CachedReview): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(review), "utf8");
}
