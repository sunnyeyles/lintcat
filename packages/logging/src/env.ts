import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function findLocalEnvFile(from: string = process.cwd()): string | undefined {
  let dir = from;
  while (true) {
    const candidate = join(dir, ".env.local");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Loads the nearest .env.local at or above `from`, returning its path. */
export function loadLocalEnvFile(from?: string): string | undefined {
  const file = findLocalEnvFile(from);
  if (file !== undefined) process.loadEnvFile(file);
  return file;
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; add it to .env.local`);
  return value;
}
