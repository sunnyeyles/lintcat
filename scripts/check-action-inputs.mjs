// Fails a release that drops or renames an input its major tag still publishes.
// Dependency-free: the release job never installs packages.
import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const KEY = /^( +)(["']?)([^\s"':#][^"':]*?)\2:(?:\s|$)/;

/** The names under the top-level `inputs:` map of an action.yml. */
export function parseInputNames(manifest) {
  const lines = manifest.split(/\r?\n/);
  const start = lines.findIndex((line) => /^inputs:/.test(line));
  if (start === -1) return [];
  if (!/^inputs:\s*(#.*)?$/.test(lines[start])) {
    throw new Error("inputs: must be a block mapping, one input per line");
  }

  const names = [];
  let indent = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const match = KEY.exec(line);
    if (match === null) continue;
    const width = match[1].length;
    indent ??= width;
    if (width === indent) names.push(match[3]);
  }
  return names;
}

/** Inputs `previous` declares that `next` no longer does. */
export function missingInputs(previous, next) {
  const kept = new Set(parseInputNames(next));
  return parseInputNames(previous).filter((name) => !kept.has(name));
}

function main([previousPath, nextPath, major = "the existing major tag"]) {
  if (!previousPath || !nextPath) {
    console.error("usage: check-action-inputs.mjs <published action.yml> <new action.yml> [major]");
    return 2;
  }
  const missing = missingInputs(readFileSync(previousPath, "utf8"), readFileSync(nextPath, "utf8"));
  if (missing.length > 0) {
    const list = missing.map((name) => `\`${name}\``).join(", ");
    console.log(
      `::error title=Breaking input change::This release removes or renames ${list}, ` +
        `which ${major} still publishes. Moving ${major} would break every workflow pinned to it: ` +
        `restore the input(s), or release under the next major version instead.`,
    );
    return 1;
  }
  console.log(`Every input ${major} publishes is still declared.`);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
