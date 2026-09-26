import path from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadLocalEnvFile } from "@pr-review/logging";

import { processEnvironment } from "#src/environment";
import { createServer } from "#src/server";

// This project's .env.local, found from the server's own files, never the client's cwd.
const envFile = loadLocalEnvFile(path.dirname(fileURLToPath(import.meta.url)));

// stdout carries the protocol, so every log line goes to stderr.
const environment = processEnvironment();
await createServer(environment).connect(new StdioServerTransport());
environment.logger.info("mcp.started", { cwd: environment.cwd, envFile });
