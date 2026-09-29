import type { ReviewMapInputs } from "@pr-review/db";
import type { RepositoryGraphSnapshot } from "@pr-review/index";

import { mapFromSnapshot, type MapSource } from "@/lib/codebase-map";

export interface MapSourceDeps {
  /** The access check: null when the reader may not see the review. */
  access(reviewId: number): Promise<{ repoId: number; baseSha: string | null } | null>;
  baseGraph(repoId: number, baseSha: string): Promise<RepositoryGraphSnapshot | null>;
  reviewInputs(reviewId: number): Promise<ReviewMapInputs | null>;
}

/** Undefined means the reader may not see the review; no cache is read before access passes. */
export function createMapSourceLoader(deps: MapSourceDeps) {
  return async (reviewId: number): Promise<MapSource | undefined> => {
    const access = await deps.access(reviewId);
    if (!access) return undefined;

    const [snapshot, inputs] = await Promise.all([
      access.baseSha === null ? null : deps.baseGraph(access.repoId, access.baseSha),
      deps.reviewInputs(reviewId),
    ]);
    if (!inputs) return undefined;

    // Without a changed list there is no PR to overlay, so none can be missing.
    const overlay = inputs.changedFiles.length > 0 ? inputs.overlay : undefined;
    return mapFromSnapshot(
      snapshot ?? undefined,
      inputs.changedFiles,
      inputs.findings,
      inputs.dependents,
      overlay,
    );
  };
}
