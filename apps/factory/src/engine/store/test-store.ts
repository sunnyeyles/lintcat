import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { factoryMigrationsFolder, type FactoryDatabase } from "#src/engine/store/client";
import * as schema from "#src/engine/store/schema";

/** An in-memory Postgres with `drizzle/` applied. */
export async function createTestFactoryDatabase(): Promise<FactoryDatabase> {
  const database = drizzle(new PGlite(), { schema });
  await migrate(database, { migrationsFolder: factoryMigrationsFolder(), migrationsSchema: "factory" });
  return database;
}
