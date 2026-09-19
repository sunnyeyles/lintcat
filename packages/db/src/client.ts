import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { databaseUrl } from "./env";
import * as schema from "./schema";

// Driver-agnostic so tests can pass a pglite client where production passes Neon.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Database | undefined;

// Lazy so importing the package never needs DATABASE_URL; only a query does.
export function db(): Database {
  cached ??= drizzle(neon(databaseUrl()), { schema });
  return cached;
}
