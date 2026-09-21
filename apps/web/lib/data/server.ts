import { db } from "@pr-review/db";
import { createDbSource, type DataSource } from "@pr-review/db/dashboard";
import type { RepositoryGraphSnapshot } from "@pr-review/index";
import type { ReviewRecordChangedFile } from "@pr-review/schemas";
import { cache } from "react";

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
