import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The nearest .env.local at or above `from`. */
export function findLocalEnvFile(from: string = process.cwd()): string | undefined {
  let dir = from;
  while (true) {
    const candidate = join(dir, ".env.local");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// Vercel injects DATABASE_URL; locally it comes from the nearest .env.local up the tree.
export function loadLocalEnv(): void {
  if (process.env.DATABASE_URL) return;
  const file = findLocalEnvFile();
  if (file) process.loadEnvFile(file);
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; add it to .env.local`);
  return value;
}

export function databaseUrl(): string {
  loadLocalEnv();
  return requiredEnv("DATABASE_URL");
}
