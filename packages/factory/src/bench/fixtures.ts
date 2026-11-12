/** Benchmark fixtures: a seeded repo, an approved spec and hidden checks the agent never sees. */
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { specSchema, type Spec } from "#src/contract";

const run = promisify(execFile);

export interface Fixture {
  name: string;
  dir: string;
  description: string;
  checks: string;
  baseSha: string;
  spec: Spec;
  hiddenDir: string;
}

const metaSchema = z.object({
  description: z.string().min(1),
  checks: z.string().min(1),
  baseSha: z.string().regex(/^[0-9a-f]{40}$/),
});

const FIXED_DATE = "2026-01-01T00:00:00+0000";

// User and system git config (signing, hooks, autocrlf, templates) would change the SHA.
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Factory Bench",
  GIT_AUTHOR_EMAIL: "bench@factory.invalid",
  GIT_AUTHOR_DATE: FIXED_DATE,
  GIT_COMMITTER_NAME: "Factory Bench",
  GIT_COMMITTER_EMAIL: "bench@factory.invalid",
  GIT_COMMITTER_DATE: FIXED_DATE,
};

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, ...args], { env: { ...process.env, ...GIT_ENV } });
  return stdout.trim();
}

export function listFixtures(benchDir: string): string[] {
  const root = path.join(benchDir, "fixtures");
  return readdirSync(root)
    .filter((name) => existsSync(path.join(root, name, "fixture.json")))
    .sort();
}

export function loadFixture(benchDir: string, name: string): Fixture {
  const dir = path.join(benchDir, "fixtures", name);
  if (!existsSync(path.join(dir, "fixture.json"))) throw new Error(`no fixture ${name} in ${benchDir}`);
  const meta = metaSchema.parse(JSON.parse(readFileSync(path.join(dir, "fixture.json"), "utf8")));
  const spec = specSchema.parse(JSON.parse(readFileSync(path.join(dir, "spec.json"), "utf8")));
  return { name, dir, ...meta, spec, hiddenDir: path.join(dir, "hidden") };
}

function filesUnder(root: string, prefix = ""): string[] {
  return readdirSync(path.join(root, prefix))
    .filter((entry) => entry !== ".DS_Store")
    .sort()
    .flatMap((entry) => {
      const relative = path.join(prefix, entry);
      return statSync(path.join(root, relative)).isDirectory() ? filesUnder(root, relative) : [relative];
    });
}

/** Builds the fixture repo in `target` and refuses it unless its HEAD is the recorded SHA. */
export async function buildFixture(fixture: Fixture, target: string): Promise<{ repoPath: string; sha: string }> {
  const source = path.join(fixture.dir, "repo");
  await mkdir(target, { recursive: true });
  await git(target, "init", "-q", "-b", "main");
  for (const file of filesUnder(source)) {
    await mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await writeFile(path.join(target, file), readFileSync(path.join(source, file)), { mode: 0o644 });
  }
  await git(target, "add", "-A");
  await git(target, "commit", "-q", "--no-verify", "-m", `fixture: ${fixture.name}`);
  const sha = await git(target, "rev-parse", "HEAD");
  if (sha !== fixture.baseSha) {
    throw new Error(`fixture ${fixture.name} built at ${sha}, expected ${fixture.baseSha}: its repo/ files changed`);
  }
  await git(target, "config", "user.name", GIT_ENV.GIT_AUTHOR_NAME);
  await git(target, "config", "user.email", GIT_ENV.GIT_AUTHOR_EMAIL);
  await git(target, "config", "commit.gpgsign", "false");
  await mkdir(path.join(target, ".factory"), { recursive: true });
  await writeFile(path.join(target, ".factory", "checks"), `${fixture.checks}\n`);
  return { repoPath: target, sha };
}
