/**
 * Bundles src/index.ts into dist/index.mjs, a self-contained ESM file for Node
 * 22+. Run from an app directory via its `build` script.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { appBundlePaths, bundle } from "./lib/bundle.mjs";

const paths = appBundlePaths(process.cwd());

await rm(path.dirname(paths.outfile), { recursive: true, force: true });

await bundle(paths);
