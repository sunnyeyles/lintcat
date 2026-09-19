import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findLocalEnvFile } from "@pr-review/db";

import { processEnvironment } from "#src/environment";
import { createServer } from "#src/server";

// This project's .env.local, found from the server's own files, never the client's cwd.
const envFile = findLocalEnvFile(path.dirname(fileURLToPath(import.meta.url)));
if (envFile !== undefined) process.loadEnvFile(envFile);

// stdout carries the protocol, so every log line goes to stderr.
const environment = processEnvironment();
await createServer(environment).connect(new StdioServerTransport());
environment.logger.info("mcp.started", { cwd: environment.cwd, envFile });
