import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";
import { z } from "zod";

import { DEFAULT_DEPLOY_CONFIG, type DeployImpactConfig } from "#src/engine/deploy-impact";

const fileSchema = z
  .object({
    envExamples: z.array(z.string().min(1)).optional(),
    migrations: z.array(z.string().min(1)).optional(),
    deployConfig: z.array(z.string().min(1)).optional(),
    ignoreEnv: z.array(z.string().min(1)).optional(),
  })
  .strict();

/** `.factory/deploy` in the main repo; a list it gives replaces that list's defaults. */
export async function loadDeployConfig(repoRoot: string): Promise<DeployImpactConfig> {
  const file = path.join(repoRoot, ".factory", "deploy");
  if (!existsSync(file)) return DEFAULT_DEPLOY_CONFIG;
  let raw: unknown;
  try {
    raw = parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`.factory/deploy is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = fileSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new Error(`.factory/deploy is malformed: ${z.prettifyError(parsed.error).replace(/\n/g, "; ")}`);
  return { ...DEFAULT_DEPLOY_CONFIG, ...parsed.data };
}
