/** Who to ask for review: who last wrote the lines a change touches, then CODEOWNERS. Never throws. */
import {
  reviewCorrelation,
  type BlameRange,
  type ChangedFile,
  type RepositoryHistoryClient,
} from "@pr-review/github";
import { ownersOf, parseCodeowners } from "@pr-review/index";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { changeStatus } from "#src/blast-radius";
import { baseRangesFromPatch, type LineRange } from "#src/diff-lines";
import type { ReviewTarget } from "#src/review-target";

export const MAX_SUGGESTED_REVIEWERS = 3;
export const MAX_BLAMED_FILES = 10;
export const BLAME_CONCURRENCY = 4;
const HALF_LIFE_DAYS = 180;
const DAY_MS = 86_400_000;

/** `handle` has no `@`; a team reads `org/team`. */
export type SuggestedReviewer =
  | { readonly handle: string; readonly source: "blame"; readonly percent: number }
  | { readonly handle: string; readonly source: "codeowners" };

/** One base file to blame; `touched` undefined means every line. */
interface BlameTarget {
  readonly path: string;
  readonly touched: readonly LineRange[] | undefined;
}

export interface BlamedFile {
  readonly ranges: readonly BlameRange[];
  readonly touched: readonly LineRange[] | undefined;
}

function baseTarget(file: ChangedFile): BlameTarget | undefined {
  const status = changeStatus(file.status);
  if (status === "added") {
    return undefined;
  }
  const path = file.previous_filename ?? file.filename;
  if (file.patch === undefined) {
    return status === "removed" ? { path, touched: undefined } : undefined;
  }
  const touched = baseRangesFromPatch(file.patch);
  return touched.length === 0 ? undefined : { path, touched };
}

/** The largest changes with base lines to blame, at most MAX_BLAMED_FILES. */
export function blameTargets(changedFiles: readonly ChangedFile[]): BlameTarget[] {
  return changedFiles
    .flatMap((file) => {
      const blamed = baseTarget(file);
      return blamed === undefined
        ? []
        : [{ blamed, size: file.additions + file.deletions }];
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_BLAMED_FILES)
    .map(({ blamed }) => blamed);
}

/** Halves every HALF_LIFE_DAYS; a future or unreadable date counts as today or nothing. */
export function recencyWeight(committedAt: string, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - Date.parse(committedAt)) / DAY_MS);
  return Number.isFinite(ageDays) ? 0.5 ** (ageDays / HALF_LIFE_DAYS) : 0;
}

function overlap(
  range: BlameRange,
  touched: readonly LineRange[] | undefined,
): number {
  if (touched === undefined) {
    return range.endLine - range.startLine + 1;
  }
  return touched.reduce(
    (lines, span) =>
      lines +
      Math.max(
        0,
        Math.min(range.endLine, span.endLine) -
          Math.max(range.startLine, span.startLine) +
          1,
      ),
    0,
  );
}

/** Every CODEOWNERS owner of these paths, owners of more paths first. */
export function codeownersOf(
  text: string | undefined,
  paths: readonly string[],
): string[] {
  if (text === undefined) {
    return [];
  }
  const rules = parseCodeowners(text);
  const owned = new Map<string, number>();
  for (const path of paths) {
    for (const owner of new Set(ownersOf(rules, path))) {
      owned.set(owner, (owned.get(owner) ?? 0) + 1);
    }
  }
  return [...owned.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([owner]) => owner);
}

interface RankRequest {
  blamed: readonly BlamedFile[];
  /** CODEOWNERS owners as written, `@user` or `@org/team`. */
  owners: readonly string[];
  /** The pull request's author, never suggested. */
  author: string | null;
  now: Date;
}

/** Blame candidates by weighted share, then CODEOWNERS in the slots left. */
export function rankReviewers({
  blamed,
  owners,
  author,
  now,
}: RankRequest): SuggestedReviewer[] {
  const excluded = (handle: string): boolean => {
    const lower = handle.toLowerCase();
    return lower === author?.toLowerCase() || lower.endsWith("[bot]");
  };
  let total = 0;
  const weights = new Map<string, { handle: string; weight: number }>();
  for (const file of blamed) {
    for (const range of file.ranges) {
      const weight =
        overlap(range, file.touched) * recencyWeight(range.committedAt, now);
      // The share is of every touched line, the author's and bots' included.
      total += weight;
      if (range.login === null || excluded(range.login) || weight === 0) {
        continue;
      }
      const key = range.login.toLowerCase();
      const entry = weights.get(key) ?? { handle: range.login, weight: 0 };
      entry.weight += weight;
      weights.set(key, entry);
    }
  }

  const picked = new Set(weights.keys());
  const byBlame = [...weights.values()]
    .sort((a, b) => b.weight - a.weight || a.handle.localeCompare(b.handle))
    .map(
      ({ handle, weight }): SuggestedReviewer => ({
        handle,
        source: "blame",
        // Floored so the shares shown never sum past 100; 1e-9 absorbs float error.
        percent: Math.floor((weight * 100) / total + 1e-9),
      }),
    );
  const byOwnership: SuggestedReviewer[] = [];
  for (const owner of owners) {
    const handle = owner.replace(/^@/, "");
    const key = handle.toLowerCase();
    if (!excluded(handle) && !picked.has(key)) {
      picked.add(key);
      byOwnership.push({ handle, source: "codeowners" });
    }
  }
  return [...byBlame, ...byOwnership].slice(0, MAX_SUGGESTED_REVIEWERS);
}

/** Runs `task` over `items` with at most `limit` in flight, keeping their order. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const at = next;
      next += 1;
      results[at] = await task(items[at]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

interface SuggestReviewersRequest {
  /** Without `blame`, as on an adapter with no commits, only CODEOWNERS can answer. */
  client: Partial<Pick<RepositoryHistoryClient, "blame">>;
  target: ReviewTarget;
  baseSha: string;
  author: string | null;
  /** Every file the pull request changed, not just an incremental scope. */
  changedFiles: readonly ChangedFile[];
  /** The base commit's CODEOWNERS text, when the archive was read and held one. */
  codeowners: string | undefined;
  enabled: boolean;
  now: Date;
  logger: StructuredLogger;
}

/** Empty when switched off, when nobody qualifies, or when ranking fails. */
export async function suggestReviewers({
  client,
  target,
  baseSha,
  author,
  changedFiles,
  codeowners,
  enabled,
  now,
  logger,
}: SuggestReviewersRequest): Promise<SuggestedReviewer[]> {
  const fields = reviewCorrelation(target);
  if (!enabled) {
    logger.info("reviewers.skipped", {
      ...fields,
      reason: "reviewer suggestions are off",
    });
    return [];
  }

  const startedAt = Date.now();
  try {
    const targets = client.blame === undefined ? [] : blameTargets(changedFiles);
    const results = await mapBounded(
      targets,
      BLAME_CONCURRENCY,
      async (file): Promise<BlamedFile | undefined> => {
        try {
          const ranges =
            (await client.blame?.({
              owner: target.owner,
              repo: target.repo,
              ref: baseSha,
              path: file.path,
            })) ?? [];
          return { ranges, touched: file.touched };
        } catch (error) {
          logger.error("reviewers.blame_failed", {
            ...fields,
            path: file.path,
            reason: errorMessage(error),
            fallback: "ranking without this file",
          });
          return undefined;
        }
      },
    );
    const blamed = results.filter((file) => file !== undefined);
    const reviewers = rankReviewers({
      blamed,
      owners: codeownersOf(
        codeowners,
        changedFiles.map((file) => file.filename),
      ),
      author,
      now,
    });
    logger.info("reviewers.suggested", {
      ...fields,
      count: reviewers.length,
      blamedFileCount: blamed.length,
      failedFileCount: results.length - blamed.length,
      durationMs: Date.now() - startedAt,
    });
    return reviewers;
  } catch (error) {
    logger.error("reviewers.failed", {
      ...fields,
      reason: errorMessage(error),
      durationMs: Date.now() - startedAt,
      fallback: "publishing without suggested reviewers",
    });
    return [];
  }
}
