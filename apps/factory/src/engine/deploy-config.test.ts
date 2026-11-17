import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadDeployConfig } from "#src/engine/deploy-config";
import { DEFAULT_DEPLOY_CONFIG } from "#src/engine/deploy-impact";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repo(deploy?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "factory-deploy-"));
  dirs.push(root);
  if (deploy !== undefined) {
    await mkdir(path.join(root, ".factory"));
    await writeFile(path.join(root, ".factory", "deploy"), deploy);
  }
  return root;
}

describe("loadDeployConfig", () => {
  it("uses the defaults without a file", async () => {
    expect(await loadDeployConfig(await repo())).toEqual(DEFAULT_DEPLOY_CONFIG);
  });

  it("replaces only the lists the file gives", async () => {
    const config = await loadDeployConfig(await repo('envExamples: [".env.example"]\nignoreEnv: [LANGFUSE_RELEASE]\n'));
    expect(config).toEqual({ ...DEFAULT_DEPLOY_CONFIG, envExamples: [".env.example"], ignoreEnv: ["LANGFUSE_RELEASE"] });
  });

  it.each([
    ["unknown key", "targets: []\n"],
    ["not a list", "migrations: drizzle/*.sql\n"],
    ["invalid yaml", "envExamples: [\n"],
    ["not a mapping", "- a\n"],
  ])("rejects %s, naming the file (AC9)", async (_, text) => {
    await expect(loadDeployConfig(await repo(text))).rejects.toThrow(/^\.factory\/deploy /);
  });
});
