/** Confines file tools to one root, symlinks included. */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

const PATH_KEYS = ["file_path", "path", "notebook_path"] as const;

function realpathOfNearestExisting(target: string): string {
  let current = target;
  const rest: string[] = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    rest.unshift(path.basename(current));
    current = parent;
  }
  return path.join(realpathSync(current), ...rest);
}

/** Null when allowed, else the reason. `.git` is denied so a worktree's gitdir pointer can't be rewritten. */
export function checkToolPath(root: string, toolInput: unknown): string | null {
  if (typeof toolInput !== "object" || toolInput === null) return null;
  const realRoot = realpathSync(root);
  for (const key of PATH_KEYS) {
    const value = (toolInput as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.includes("\0")) return `${key} is not a valid path`;
    const resolved = realpathOfNearestExisting(path.resolve(root, value));
    const relative = path.relative(realRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return `${key} ${value} is outside the run's worktree`;
    }
    if (relative.split(path.sep).includes(".git")) return `${key} ${value} is inside .git`;
  }
  return null;
}
