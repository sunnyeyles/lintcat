import { db } from "@pr-review/db";
import { createDbSource, type DataSource } from "@pr-review/db/dashboard";
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
