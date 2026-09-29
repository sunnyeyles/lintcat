/** The map's change overlay: HEAD imports of the changed files, diffed against the base index. Never throws. */
import type { ChangedFile, PullRequestReadClient } from "@pr-review/github";
import {
  buildChangeOverlay,
  INDEXED_LANGUAGES,
  languageOf,
  type ChangeOverlay,
  type RepositoryIndex,
} from "@pr-review/index";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import { MAX_OVERLAY_EDGES, MAX_OVERLAY_FILES } from "@pr-review/schemas";

import { impactChanges } from "#src/blast-radius";
import { reviewCorrelation, type ReviewTarget } from "#src/review-target";

/** HEAD bytes read before the overlay stops and calls itself partial. */
const MAX_OVERLAY_BYTES = 2_000_000;

const CONCURRENCY = 8;

interface ChangeOverlayRequest {
  client: Pick<PullRequestReadClient, "getFileContents">;
  target: ReviewTarget;
  index: RepositoryIndex | undefined;
  /** Every file the pull request changed, not just an incremental scope. */
  changedFiles: readonly ChangedFile[];
  logger: StructuredLogger;
}

/** undefined without an index, or when anything about it fails. */
export async function loadChangeOverlay({
  client,
  target,
  index,
  changedFiles,
  logger,
}: ChangeOverlayRequest): Promise<ChangeOverlay | undefined> {
  if (index === undefined) {
    return undefined;
  }
  const fields = reviewCorrelation(target);
  const startedAt = Date.now();
  try {
    const all = impactChanges(changedFiles);
    let partial = all.length > MAX_OVERLAY_FILES;
    const changes = all.slice(0, MAX_OVERLAY_FILES);
    const wanted = changes
      .filter(
        (change) =>
          change.status !== "removed" && INDEXED_LANGUAGES.has(languageOf(change.path)),
      )
      .map((change) => change.path);

    const contents = new Map<string, string>();
    let bytes = 0;
    for (let start = 0; start < wanted.length; start += CONCURRENCY) {
      if (bytes > MAX_OVERLAY_BYTES) {
        partial = true;
        break;
      }
      const batch = await Promise.all(
        wanted.slice(start, start + CONCURRENCY).map(async (path) => {
          const text = await client.getFileContents({
            owner: target.owner,
            repo: target.repo,
            path,
            ref: target.headSha,
          });
          return [path, text] as const;
        }),
      );
      for (const [path, text] of batch) {
        bytes += Buffer.byteLength(text, "utf8");
        contents.set(path, text);
      }
    }

    const built = buildChangeOverlay(index, {
      headSha: target.headSha,
      changes,
      contents,
      partial,
    });
    const capped =
      built.added.length > MAX_OVERLAY_EDGES || built.removed.length > MAX_OVERLAY_EDGES;
    const overlay: ChangeOverlay = capped
      ? {
          ...built,
          added: built.added.slice(0, MAX_OVERLAY_EDGES),
          removed: built.removed.slice(0, MAX_OVERLAY_EDGES),
          partial: true,
        }
      : built;
    logger.info("overlay.built", {
      ...fields,
      fileCount: overlay.files.length,
      addedCount: overlay.added.length,
      removedCount: overlay.removed.length,
      unresolvedImportCount: overlay.unresolvedImportCount,
      partial: overlay.partial,
      durationMs: Date.now() - startedAt,
    });
    return overlay;
  } catch (error) {
    logger.error("overlay.failed", {
      ...fields,
      reason: errorMessage(error),
      durationMs: Date.now() - startedAt,
      fallback: "publishing without the change overlay",
    });
    return undefined;
  }
}
