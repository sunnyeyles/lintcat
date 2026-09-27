import { db } from "@pr-review/db";
import { createDbSource, type DataSource } from "@pr-review/db/dashboard";
import type { RepositoryGraphSnapshot } from "@pr-review/index";
import { cache } from "react";

import {
  mapFromSnapshot,
  normaliseGraph,
  type MapSource,
  type MapSourceFinding,
  type NormalisedGraph,
} from "@/lib/codebase-map";
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

/** Decoding and normalising a 50k-file snapshot is not free, and expanding a group asks again. */
const SNAPSHOTS_HELD = 2;

interface HeldGraph {
  snapshot: RepositoryGraphSnapshot | undefined;
  /** Keyed by the changed files and blast radius the graph was also built from. */
  normalised?: { inputs: string; graph: NormalisedGraph };
}

const snapshots = new Map<string, HeldGraph>();

async function cachedGraph(
  key: string,
  load: () => Promise<RepositoryGraphSnapshot | undefined>,
): Promise<HeldGraph> {
  const held = snapshots.get(key);
  if (held) {
    snapshots.delete(key);
    snapshots.set(key, held);
    return held;
  }
  const entry: HeldGraph = { snapshot: await load() };
  snapshots.set(key, entry);
  while (snapshots.size > SNAPSHOTS_HELD) {
    snapshots.delete(snapshots.keys().next().value!);
  }
  return entry;
}

/**
 * Everything the map is drawn from. Undefined means the review is not one this
 * user may read, which the caller answers as a 404.
 */
export async function getMapSource(
  slug: string,
  reviewId: number,
): Promise<MapSource | undefined> {
  const review = await (await data(slug)).getReview(reviewId);
  return review
    ? reviewMapSource(slug, reviewId, review.findings, review.risk?.dependents)
    : undefined;
}

/** The map for a review the caller has already loaded, so its findings come along. */
export async function reviewMapSource(
  slug: string,
  reviewId: number,
  findings: readonly MapSourceFinding[],
  dependents?: readonly string[],
): Promise<MapSource> {
  const source = await data(slug);
  const [held, changedFiles] = await Promise.all([
    cachedGraph(`${slug}\u0000${reviewId}`, () => source.getRepositoryGraph(reviewId)),
    source.getChangedFiles(reviewId),
  ]);
  const map = mapFromSnapshot(held.snapshot, changedFiles, findings, dependents);
  if (!map.graph) return map;

  const inputs = JSON.stringify([changedFiles.map((f) => [f.path, f.status]), dependents ?? []]);
  if (held.normalised?.inputs !== inputs) {
    held.normalised = { inputs, graph: normaliseGraph(map.graph) };
  }
  return { ...map, normalised: held.normalised.graph };
}
