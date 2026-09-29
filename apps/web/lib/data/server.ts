import { db, findRepositoryGraph, findReviewMapInputs } from "@pr-review/db";
import { createDbSource, type DataSource } from "@pr-review/db/dashboard";
import { unstable_cache } from "next/cache";
import { cache } from "react";

import type { MapSource } from "@/lib/codebase-map";
import { createMapSourceLoader } from "@/lib/data/map-source";
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

// A base commit's graph never changes, and every review on that base shares it.
const baseGraph = unstable_cache(
  async (repoId: number, baseSha: string) =>
    (await findRepositoryGraph(db(), repoId, baseSha)) ?? null,
  ["codebase-map-base-graph"],
  { revalidate: 60 * 60 * 24 },
);

// A rerun of the same head replaces the review in place, so this entry stays short-lived.
const reviewInputs = unstable_cache(
  async (reviewId: number) => (await findReviewMapInputs(db(), reviewId)) ?? null,
  ["codebase-map-review-inputs"],
  { revalidate: 300 },
);

/** The one loader the review page and the map route share. */
export async function loadMapSource(
  slug: string,
  reviewId: number,
): Promise<MapSource | undefined> {
  const source = await data(slug);
  return createMapSourceLoader({
    access: (id) => source.getMapAccess(id),
    baseGraph,
    reviewInputs,
  })(reviewId);
}
