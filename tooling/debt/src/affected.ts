import type { Graph } from "#src/graph";
import { packageForFile, transitiveDependents } from "#src/graph";
import { parseJson, run } from "#src/run";

export interface Affected {
  packages: string[];
  method: "all" | "turbo" | "git";
  base: string | null;
}

// Any of these changes can move every package's numbers, so the whole repo is affected.
const GLOBAL_FILES = /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tsconfig\.base\.json|vitest\.config\.ts|knip\.json|tooling\/|\.github\/)/;

function resolveBase(root: string): string | null {
  const configured = process.env.TURBO_SCM_BASE;
  for (const candidate of [configured, "origin/main", "main"]) {
    if (!candidate) continue;
    if (run("git", ["rev-parse", "--verify", "--quiet", candidate], { cwd: root }).status === 0) return candidate;
  }
  return null;
}

function onBase(root: string, base: string): boolean {
  const head = run("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.trim();
  const baseSha = run("git", ["rev-parse", base], { cwd: root }).stdout.trim();
  return head !== "" && head === baseSha;
}

function changedFiles(root: string, base: string): string[] {
  const committed = run("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: root }).stdout;
  const working = run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root })
    .stdout.split("\n")
    .map((line) => line.slice(3).trim());
  return [...new Set([...committed.split("\n"), ...working].map((f) => f.trim()).filter(Boolean))].sort();
}

export function packagesFromFiles(graph: Graph, files: string[]): string[] | "all" {
  const direct = new Set<string>();
  for (const file of files) {
    if (GLOBAL_FILES.test(file)) return "all";
    const pkg = packageForFile(graph, file);
    if (pkg) direct.add(pkg);
  }
  return [...transitiveDependents(graph, direct)].sort();
}

function turboAffected(root: string, base: string): string[] | null {
  const result = run("turbo", ["ls", "--affected", "--output=json"], { cwd: root, env: { TURBO_SCM_BASE: base } });
  if (result.status !== 0) return null;
  const parsed = parseJson<{ packages?: { items?: Array<{ name: string }> } }>(result.stdout);
  const items = parsed?.packages?.items;
  return items ? items.map((i) => i.name).sort() : null;
}

export function affectedPackages(root: string, graph: Graph, all = false): Affected {
  const everything = Object.keys(graph.nodes).sort();
  const base = resolveBase(root);
  if (all || base === null || onBase(root, base)) return { packages: everything, method: "all", base };

  const files = changedFiles(root, base);
  const fromGit = packagesFromFiles(graph, files);
  if (fromGit === "all") return { packages: everything, method: "all", base };

  const fromTurbo = turboAffected(root, base);
  const merged = new Set([...fromGit, ...(fromTurbo ?? [])]);
  return { packages: [...merged].sort(), method: fromTurbo ? "turbo" : "git", base };
}
