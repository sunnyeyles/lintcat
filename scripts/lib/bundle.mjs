/**
 * The one esbuild configuration this repository bundles with. Nothing is
 * externalised.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

/**
 * ESM output over CJS dependencies: esbuild's shim needs `require`,
 * `__filename` and `__dirname` in scope or the bundle throws at runtime.
 */
const BANNER = `import { createRequire as __banner_createRequire } from "node:module";
import { fileURLToPath as __banner_fileURLToPath } from "node:url";
import { dirname as __banner_dirname } from "node:path";
const require = __banner_createRequire(import.meta.url);
const __filename = __banner_fileURLToPath(import.meta.url);
const __dirname = __banner_dirname(__filename);
`;

/** Bundles one TypeScript entry point into a self-contained ESM file. */
export function bundle({ entryPoint, outfile, logLevel = "info" }) {
  return build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    banner: { js: BANNER },
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel,
  });
}

export function appBundlePaths(appDir) {
  return {
    entryPoint: path.join(appDir, "src", "index.ts"),
    outfile: path.join(appDir, "dist", "index.mjs"),
  };
}

/** An app's `start.mjs`: bundles its `src/index.ts` and runs the result. */
export async function bundleAndRun(appUrl) {
  const paths = appBundlePaths(path.dirname(fileURLToPath(appUrl)));
  await bundle({ ...paths, logLevel: "error" });
  await import(pathToFileURL(paths.outfile).href);
}
