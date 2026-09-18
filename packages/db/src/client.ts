import { neon, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import {
  drizzle as drizzleSession,
  type NeonDatabase,
} from "drizzle-orm/neon-serverless";
import { databaseUrl } from "./env.js";
import * as schema from "./schema.js";

export type Database = NeonHttpDatabase<typeof schema>;

/** The WebSocket client: slower per query, but it can hold a transaction open. */
export type SessionDatabase = NeonDatabase<typeof schema>;

let cached: Database | undefined;
let cachedSession: SessionDatabase | undefined;

// Lazy so importing the package never needs DATABASE_URL; only a query does.
export function db(): Database {
  cached ??= drizzle(neon(databaseUrl()), { schema });
  return cached;
}

// One long-lived pool, over Node 22's global WebSocket; neon-http has no transactions.
export function dbSession(): SessionDatabase {
  cachedSession ??= drizzleSession(
    new Pool({ connectionString: databaseUrl() }),
    { schema },
  );
  return cachedSession;
}
