import { db } from "@pr-review/db";

import { requireOrganization } from "@/lib/session";

import { createDbSource } from "./db";
import type { DataSource } from "./types";

/** The organization's data, only once `requireOrganization` has let the user in. */
export async function data(slug: string): Promise<DataSource> {
  const { organization } = await requireOrganization(slug);
  return createDbSource(db(), organization);
}
