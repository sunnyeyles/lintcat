import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "./client";
import * as schema from "./schema";

const migrationsFolder = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
);

/** An in-memory Postgres with `drizzle/` applied. No DATABASE_URL needed. */
export async function createTestDatabase(): Promise<Database> {
  const database = drizzle(new PGlite(), { schema });
  await migrate(database, { migrationsFolder });
  return database;
}
