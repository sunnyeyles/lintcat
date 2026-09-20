#!/usr/bin/env node
// Rebuilds (about 150ms) before every run, so a hook never reviews with stale code.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { bundle } from "../../scripts/lib/bundle.mjs";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(appDir, "dist", "index.mjs");

await bundle({ entryPoint: path.join(appDir, "src", "index.ts"), outfile, logLevel: "error" });
await import(pathToFileURL(outfile).href);
