import { db } from "@pr-review/db";
import { createDbSource, type DataSource } from "@pr-review/db/dashboard";
import type { RepositoryGraphSnapshot } from "@pr-review/index";
import type { ReviewRecordChangedFile } from "@pr-review/schemas";
import { cache } from "react";

import { mapFromSnapshot, type MapSource } from "@/lib/codebase-map";
import { requireOrganization } from "@/lib/session";

/** The organization's data, only once `requireOrganization` has let the user in. */
export const data = cache(async (slug: string): Promise<DataSource> => {
  const { organization, readableRepos } = await requireOrganization(slug);
  return createDbSource(
    db(),
    organization,
    readableRepos.map((repo) => repo.id),
  );
});

/** The repository graph a review was made against, undefined when none was stored. */
export async function getRepositoryGraph(
  slug: string,
  reviewId: number,
): Promise<RepositoryGraphSnapshot | undefined> {
  return (await data(slug)).getRepositoryGraph(reviewId);
}

export async function getChangedFiles(
  slug: string,
  reviewId: number,
): Promise<ReviewRecordChangedFile[]> {
  return (await data(slug)).getChangedFiles(reviewId);
}

/** Decoding a 50k-file snapshot is not free, and expanding a group asks again. */
const SNAPSHOTS_HELD = 2;
const snapshots = new Map<string, RepositoryGraphSnapshot | undefined>();

async function cachedGraph(
  key: string,
  load: () => Promise<RepositoryGraphSnapshot | undefined>,
): Promise<RepositoryGraphSnapshot | undefined> {
  if (snapshots.has(key)) {
    const held = snapshots.get(key);
    snapshots.delete(key);
    snapshots.set(key, held);
    return held;
  }
  const snapshot = await load();
  snapshots.set(key, snapshot);
  while (snapshots.size > SNAPSHOTS_HELD) {
    snapshots.delete(snapshots.keys().next().value!);
  }
  return snapshot;
}

/**
 * Everything the map is drawn from. Undefined means the review is not one this
 * user may read, which the caller answers as a 404.
 */
export async function getMapSource(
  slug: string,
  reviewId: number,
): Promise<MapSource | undefined> {
  const source = await data(slug);
  const review = await source.getReview(reviewId);
  if (!review) return undefined;

  const [snapshot, changedFiles] = await Promise.all([
    cachedGraph(`${slug}\u0000${reviewId}`, () => source.getRepositoryGraph(reviewId)),
    source.getChangedFiles(reviewId),
  ]);
  return mapFromSnapshot(snapshot, changedFiles, review.findings);
}
