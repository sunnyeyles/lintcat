import { db } from "@pr-review/db";

import type { RunTraceDeps } from "./handler";

// db() comes first because locally it is what loads .env.local.
export function runTraceDeps(): RunTraceDeps {
  const database = db();
  return { database, token: process.env.RUN_TRACE_TOKEN, now: () => new Date() };
}
