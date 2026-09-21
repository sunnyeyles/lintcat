import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { findLocalEnvFile } from "@pr-review/db";
import { processEnvironment } from "@pr-review/mcp/local-review";

import { runCli } from "#src/cli";
import { cancelOnInterrupt } from "#src/interrupt";

// This project's .env.local, found from the command's own files, never the checkout it reviews.
const envFile = findLocalEnvFile(path.dirname(fileURLToPath(import.meta.url)));
if (envFile !== undefined) process.loadEnvFile(envFile);

/** How to launch this command again, for the hook it installs. */
function commandLine(): string {
  const entry = process.argv[1];
  return entry === undefined ? "pr-review" : `${process.execPath} ${path.resolve(entry)}`;
}

const err = (text: string): void => {
  process.stderr.write(`${text}\n`);
};
const interrupt = cancelOnInterrupt({ source: process, err, exit: (code) => process.exit(code) });

process.exitCode = await runCli(process.argv.slice(2), {
  environment: processEnvironment(),
  out: (text) => process.stdout.write(`${text}\n`),
  err,
  isTty: process.stdout.isTTY === true,
  commandLine: commandLine(),
  signal: interrupt.signal,
});
interrupt.dispose();
