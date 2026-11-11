import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { AgentAuthError } from "@pr-review/agent-runtime";

import { runCommand } from "#src/commands";
import { EnvironmentError, findLocalEnvFile } from "#src/config";
import { parseArguments, USAGE, UsageError } from "#src/options";

// This project's .env.local, found from the command's own files, never the target repo.
const envFile = findLocalEnvFile(path.dirname(fileURLToPath(import.meta.url)));
if (envFile !== undefined) process.loadEnvFile(envFile);

const out = (text: string) => void process.stdout.write(`${text}\n`);
const err = (text: string) => void process.stderr.write(`${text}\n`);

const controller = new AbortController();
const interrupt = () => {
  if (controller.signal.aborted) process.exit(130);
  controller.abort();
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

try {
  const command = parseArguments(process.argv.slice(2));
  process.exitCode = await runCommand(
    { env: process.env, cwd: process.cwd(), out, err, signal: controller.signal, interrupt, stdin: process.stdin, stdout: process.stdout },
    command,
  );
} catch (error) {
  if (error instanceof UsageError) {
    err(`factory: ${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else if (error instanceof EnvironmentError || error instanceof AgentAuthError) {
    err(`factory: ${error.message}`);
    process.exitCode = 3;
  } else {
    err(`factory: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
