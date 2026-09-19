import { db } from "@pr-review/db";

import { requireTeam } from "@/lib/session";

import { createDbSource } from "./db";
import type { DataSource } from "./types";

/** The signed-in user's team's data; redirects to /sign-in without one. */
export async function data(): Promise<DataSource> {
  const { team } = await requireTeam();
  return createDbSource(db(), team);
}
