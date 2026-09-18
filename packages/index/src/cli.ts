/** Builds an index over a local directory and prints it. Wired to nothing. */
import { z } from "zod";

import { buildLayerA } from "./build.js";
import { buildLayerB } from "./layer-b/build.js";
import { createLocalFileSource } from "./local-source.js";
import { FILE_ROLES, type RepositoryIndexData } from "./types.js";

const fileRole = z.enum(FILE_ROLES as unknown as [string, ...string[]]);

const symbolKind = z.enum([
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "variable",
  "property",
  "module",
  "unknown",
]);

const layerB = z.object({
  symbols: z.array(
    z.object({
      id: z.number().int(),
      file: z.string(),
      name: z.string(),
      kind: symbolKind,
      line: z.number().int(),
      endLine: z.number().int(),
      exported: z.boolean(),
    }),
  ),
  references: z.array(
    z.object({
      symbol: z.number().int(),
      file: z.string(),
      line: z.number().int(),
    }),
  ),
  imports: z.array(z.object({ from: z.string(), to: z.string() })),
  coverage: z.array(
    z.object({
      language: z.string(),
      files: z.number().int(),
      indexed: z.boolean(),
      resolutionRate: z.number(),
    }),
  ),
});

const repositoryIndexData = z.object({
  version: z.literal(1),
  sha: z.string(),
  builtAt: z.string(),
  packages: z.array(
    z.object({
      name: z.string(),
      root: z.string(),
      entryPoints: z.array(z.string()),
      dependsOn: z.array(z.string()),
    }),
  ),
  files: z.array(
    z.object({
      path: z.string(),
      package: z.string().nullable(),
      role: fileRole,
      language: z.string().nullable(),
      owners: z.array(z.string()),
    }),
  ),
  tests: z.array(z.object({ test: z.string(), source: z.string() })),
  coverage: z.object({
    files: z.number().int(),
    truncated: z.boolean(),
    languages: z.record(z.string(), z.number().int()),
    manifests: z.array(z.string()),
  }),
  layerB: layerB.optional(),
});

/** Parses an index built elsewhere; throws on anything that is not one. */
export function loadIndexData(json: string): RepositoryIndexData {
  return repositoryIndexData.parse(JSON.parse(json)) as RepositoryIndexData;
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = argv.filter((argument) => argument !== "--layer-b");
  const rootDir = args[0] ?? process.cwd();
  const layerA = await buildLayerA(createLocalFileSource(rootDir, args[1] ?? "local"));
  const index: RepositoryIndexData = argv.includes("--layer-b")
    ? { ...layerA, layerB: await buildLayerB(rootDir) }
    : layerA;
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
}
