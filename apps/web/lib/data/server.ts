import { db } from "@pr-review/db";

import { requireMembership } from "@/lib/session";

import { createDbSource } from "./db";
import type { DataSource } from "./types";

/** The signed-in user's organization's data; redirects to /sign-in without one. */
export async function data(): Promise<DataSource> {
  const { organization } = await requireMembership();
  return createDbSource(db(), organization);
}
