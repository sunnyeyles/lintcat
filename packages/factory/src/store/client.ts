import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

import { assetPath } from "#src/assets";
import * as schema from "#src/store/schema";

// Driver-agnostic so tests can pass a PGlite client where production passes postgres-js.
export type FactoryDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export const factoryMigrationsFolder = () => assetPath("drizzle");

export function openFactoryDatabase(url: string): {
  database: FactoryDatabase;
  close(): Promise<void>;
} {
  const client = postgres(url, { onnotice: () => {} });
  return {
    database: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

/** Expects a database from `openFactoryDatabase`; tests migrate PGlite themselves. */
export async function migrateFactoryDatabase(database: FactoryDatabase): Promise<void> {
  await migrate(database as Parameters<typeof migrate>[0], {
    migrationsFolder: factoryMigrationsFolder(),
  });
}
