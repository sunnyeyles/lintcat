/** One review of a local checkout, shared by the MCP tool and the CLI. */
import { shortSha } from "@pr-review/schemas";

import type { McpEnvironment } from "#src/environment";
import {
  openLocalRepository,
  type LocalRepository,
  type LocalScope,
} from "#src/local-git-client";
import { openLocalMemoryStore } from "#src/local-memory-store";
import { runReview, type ReviewResult } from "#src/review";
import type { SelectedEngine } from "#src/review-engine";

export interface LocalReviewRequest {
  repoPath: string;
  base: string | undefined;
  scope: LocalScope;
  /** Called only when there is something to review. */
  selectEngine: () => SelectedEngine;
  index?: boolean | undefined;
  signal?: AbortSignal | undefined;
  onStart?: ((changedFiles: number, where: string) => void) | undefined;
}

export interface LocalReviewRun {
  local: LocalRepository;
  changedFiles: number;
  /** e.g. "the working tree of /repo against main (abc1234)". */
  where: string;
  /** Undefined when the scope holds no changes and no model was called. */
  result: ReviewResult | undefined;
}

export async function reviewLocalCheckout(
  environment: McpEnvironment,
  request: LocalReviewRequest,
): Promise<LocalReviewRun> {
  const local = await openLocalRepository(request.repoPath, request.base, request.scope);
  const files = await local.client.listChangedFiles(local.target);
  const where = `${local.scope.headLabel} of ${local.root} against ${local.baseRef} (${shortSha(local.baseSha)})`;
  const run = { local, changedFiles: files.length, where };
  if (files.length === 0) {
    return { ...run, result: undefined };
  }
  request.onStart?.(files.length, where);
  const result = await runReview(environment, {
    client: local.client,
    target: local.target,
    selected: request.selectEngine(),
    index: request.index,
    memory: await openLocalMemoryStore(local.root),
    signal: request.signal,
  });
  return { ...run, result };
}
