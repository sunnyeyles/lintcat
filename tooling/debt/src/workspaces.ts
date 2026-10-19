import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseJson, run } from "#src/run";

export type WorkspaceKind = "app" | "package" | "tooling" | "other";

export interface Workspace {
  name: string;
  dir: string;
  path: string;
  kind: WorkspaceKind;
  dependencies: string[];
  external: Record<string, string>;
  externalDev: Record<string, string>;
  exports: string[];
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: string | Record<string, unknown>;
}

export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function kindOf(dir: string): WorkspaceKind {
  const top = dir.split("/")[0];
  if (top === "apps") return "app";
  if (top === "packages") return "package";
  if (top === "tooling") return "tooling";
  return "other";
}

export function workspaceFromDir(root: string, dir: string): Workspace | null {
  const file = path.join(root, dir, "package.json");
  if (!existsSync(file)) return null;
  const pkg = parseJson<PackageJson>(readFileSync(file, "utf8"));
  if (!pkg?.name) return null;
  const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  const isWorkspace = ([, v]: [string, string]) => v.startsWith("workspace:");
  const external = (deps: Record<string, string> | undefined) =>
    Object.fromEntries(Object.entries(deps ?? {}).filter((e) => !isWorkspace(e)));
  return {
    name: pkg.name,
    dir,
    path: path.join(root, dir),
    kind: kindOf(dir),
    dependencies: Object.entries(all)
      .filter(isWorkspace)
      .map(([k]) => k)
      .sort(),
    external: external(pkg.dependencies),
    externalDev: external(pkg.devDependencies),
    exports: typeof pkg.exports === "string" ? ["."] : Object.keys(pkg.exports ?? {}).sort(),
  };
}

function workspacesFromDirs(root: string, dirs: string[]): Workspace[] {
  return dirs
    .map((dir) => workspaceFromDir(root, dir))
    .filter((w): w is Workspace => w !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function discoverWorkspaceDirs(root: string): string[] {
  const result = run("pnpm", ["-r", "ls", "--depth", "-1", "--json"], { cwd: root });
  const listed = parseJson<Array<{ path: string }>>(result.stdout);
  if (!listed) return dirsFromWorkspaceFile(root);
  return listed
    .map((p) => path.relative(root, p.path).split(path.sep).join("/"))
    .filter((dir) => dir !== "")
    .sort();
}

// Fallback when pnpm is unavailable: expand the one-level `dir/*` globs of pnpm-workspace.yaml.
function dirsFromWorkspaceFile(root: string): string[] {
  const file = path.join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) return [];
  const dirs: string[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*-\s*['"]?([^'"\s]+)/.exec(line);
    if (!match) continue;
    const pattern = match[1]!;
    if (pattern.endsWith("/*")) {
      const parent = path.join(root, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent)) dirs.push(`${pattern.slice(0, -2)}/${entry}`);
    } else dirs.push(pattern);
  }
  return dirs.filter((dir) => existsSync(path.join(root, dir, "package.json"))).sort();
}

export function loadWorkspaces(root = repoRoot): Workspace[] {
  return workspacesFromDirs(root, discoverWorkspaceDirs(root));
}
