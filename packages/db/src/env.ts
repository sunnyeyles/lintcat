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

export function databaseUrl(): string {
  loadLocalEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set; add it to .env.local");
  }
  return url;
}
