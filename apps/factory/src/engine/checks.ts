import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

interface Check {
  name: string;
  command: string;
}

export interface CheckPlan {
  install: string | null;
  checks: Check[];
  source: "file" | "detected";
}

const SCRIPT_ORDER = ["lint", "typecheck", "test", "build"] as const;

/** `.factory/checks` in the main repo overrides detection; `!name: cmd` lines are install steps. */
export async function detectChecks(repoRoot: string): Promise<CheckPlan> {
  const file = path.join(repoRoot, ".factory", "checks");
  if (existsSync(file)) return parseChecksFile(await readFile(file, "utf8"), file);
  return detect(repoRoot);
}

function parseChecksFile(text: string, file = ".factory/checks"): CheckPlan {
  const installs: string[] = [];
  const checks: Check[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    const name = colon > 0 ? line.slice(0, colon).trim() : "";
    const command = colon > 0 ? line.slice(colon + 1).trim() : "";
    if (!name || name === "!" || !command) throw new Error(`bad line in ${file}, want "name: command": ${line}`);
    if (name.startsWith("!")) installs.push(command);
    else checks.push({ name, command });
  }
  return { install: joinInstalls(installs), checks, source: "file" };
}

async function detect(root: string): Promise<CheckPlan> {
  const has = (name: string) => existsSync(path.join(root, name));
  const installs: string[] = [];
  const checks: Check[] = [];

  if (has("package.json")) {
    const pm = has("pnpm-lock.yaml")
      ? { name: "pnpm", install: "pnpm install --frozen-lockfile" }
      : has("yarn.lock")
        ? { name: "yarn", install: "yarn install --frozen-lockfile" }
        : has("bun.lock") || has("bun.lockb")
          ? { name: "bun", install: "bun install --frozen-lockfile" }
          : has("package-lock.json")
            ? { name: "npm", install: "npm ci" }
            : { name: "npm", install: "npm install" };
    installs.push(pm.install);
    const scripts = await readScripts(path.join(root, "package.json"));
    for (const script of SCRIPT_ORDER) {
      const body = scripts[script];
      if (!body || body.includes("no test specified")) continue;
      checks.push({ name: script, command: `${pm.name} run ${script}` });
    }
  }
  if (has("go.mod")) {
    installs.push("go mod download");
    checks.push({ name: "go vet", command: "go vet ./..." }, { name: "go test", command: "go test ./..." });
  }
  if (has("Cargo.toml")) {
    installs.push("cargo fetch");
    checks.push({ name: "cargo test", command: "cargo test --offline" });
  }
  if (has("uv.lock")) {
    installs.push("uv sync --frozen");
    checks.push({ name: "pytest", command: "uv run --frozen pytest" });
  }
  if (checks.length === 0 && has("Makefile")) {
    const makefile = await readFile(path.join(root, "Makefile"), "utf8");
    if (/^test:/m.test(makefile)) checks.push({ name: "make test", command: "make test" });
  }
  return { install: joinInstalls(installs), checks, source: "detected" };
}

async function readScripts(file: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { scripts?: unknown };
    const scripts = parsed.scripts;
    if (!scripts || typeof scripts !== "object") return {};
    return Object.fromEntries(Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

const joinInstalls = (installs: string[]) => (installs.length ? installs.join(" && ") : null);
