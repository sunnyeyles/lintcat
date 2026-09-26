import { loadLocalEnvFile, requiredEnv } from "@pr-review/logging";

// Vercel injects DATABASE_URL; locally it comes from the nearest .env.local up the tree.
export function loadLocalEnv(): void {
  if (process.env.DATABASE_URL) return;
  loadLocalEnvFile();
}

export function databaseUrl(): string {
  loadLocalEnv();
  return requiredEnv("DATABASE_URL");
}
