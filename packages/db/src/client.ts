import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { databaseUrl } from "./env";
import * as schema from "./schema";

// Driver-agnostic so tests can pass a pglite client where production passes Neon.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Database | undefined;

// Lazy so importing the package never needs DATABASE_URL; only a query does.
// Its HTTP driver cannot run `.transaction()`; atomic writes use `withWriteDatabase`.
export function db(): Database {
  cached ??= drizzle(neon(databaseUrl()), { schema });
  return cached;
}

/** A WebSocket pool that supports interactive transactions, closed once `run` settles. */
export async function withWriteDatabase<T>(
  run: (database: Database) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    return await run(drizzlePool(pool, { schema }));
  } finally {
    await pool.end();
  }
}
