import { db, type Database } from "@pr-review/db";

import { factoryConnectorFromEnv } from "@/lib/run-trace/connectors/factory";

import type { RunTraceDeps } from "./handler";

// Defers a missing DATABASE_URL to the first query, so connectors still answer without it.
function unavailable(cause: unknown): Database {
  return new Proxy({} as Database, {
    get() {
      throw cause;
    },
  });
}

// db() comes first because locally it is what loads .env.local.
export function runTraceDeps(): RunTraceDeps {
  let database: Database;
  try {
    database = db();
  } catch (cause) {
    database = unavailable(cause);
  }
  const factory = factoryConnectorFromEnv();
  return {
    database,
    token: process.env.RUN_TRACE_TOKEN,
    now: () => new Date(),
    connectors: factory ? [factory] : [],
  };
}
