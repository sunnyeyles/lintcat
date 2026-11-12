/** Deterministic escalation: when a light run's diff outgrows its approved estimate. */
import { existsSync } from "node:fs";
import path from "node:path";

const MANIFESTS = ["package.json", "go.mod", "Cargo.toml", "pyproject.toml"];

export type Escalation =
  | { kind: "none" }
  | { kind: "review"; reason: string }
  | { kind: "blocked"; reason: string };

function packageRootOf(worktree: string, file: string): string {
  for (let dir = path.posix.dirname(file); ; dir = path.posix.dirname(dir)) {
    const at = dir === "." ? "" : dir;
    if (MANIFESTS.some((m) => existsSync(path.join(worktree, at, m)))) return at;
    if (dir === "." || dir === "/") return "";
  }
}

/** Review past max(3, 2×estimate) files or across packages; a blocker past max(10, 5×estimate). */
export function assessEscalation(worktree: string, changed: readonly string[], estimatedFiles: number): Escalation {
  const count = changed.length;
  const hardLimit = Math.max(10, estimatedFiles * 5);
  if (count > hardLimit) {
    return { kind: "blocked", reason: `the change touches ${count} files, far beyond the approved estimate of ${estimatedFiles}; re-scope and approve it as a larger task` };
  }
  const reasons: string[] = [];
  const softLimit = Math.max(3, estimatedFiles * 2);
  if (count > softLimit) reasons.push(`${count} files changed against an estimate of ${estimatedFiles}`);
  const roots = new Set(changed.map((f) => packageRootOf(worktree, f)));
  if (roots.size > 1) reasons.push(`crosses ${roots.size} packages (${[...roots].map((r) => r || ".").sort().join(", ")})`);
  return reasons.length ? { kind: "review", reason: reasons.join("; ") } : { kind: "none" };
}
