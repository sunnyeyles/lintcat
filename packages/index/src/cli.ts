/** Builds Layer A over a local directory and prints it. Wired to nothing. */
import { buildLayerA } from "./build.js";
import { createLocalFileSource } from "./local-source.js";

export async function main(argv: readonly string[]): Promise<void> {
  const rootDir = argv[0] ?? process.cwd();
  const index = await buildLayerA(createLocalFileSource(rootDir, argv[1] ?? "local"));
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
}
