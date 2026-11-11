/** Finds the package's Markdown, YAML and migrations both from source and from a bundled app. */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;

function factoryPackageDir(): string {
  if (cached) return cached;
  const override = process.env.FACTORY_PACKAGE_DIR;
  if (override) return (cached = override);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    for (const candidate of [dir, path.join(dir, "packages", "factory")]) {
      if (existsSync(path.join(candidate, "agents")) && existsSync(path.join(candidate, "workflows"))) {
        return (cached = candidate);
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("cannot find packages/factory; set FACTORY_PACKAGE_DIR");
    dir = parent;
  }
}

export const assetPath = (...segments: string[]) => path.join(factoryPackageDir(), ...segments);
