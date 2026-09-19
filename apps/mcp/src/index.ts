import process from "node:process";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { findLocalEnvFile } from "@pr-review/db";

import { processEnvironment } from "#src/environment";
import { createServer } from "#src/server";

// Keys in the repository's .env.local apply; a variable already set wins.
const envFile = findLocalEnvFile();
if (envFile !== undefined) process.loadEnvFile(envFile);

// stdout carries the protocol, so every log line goes to stderr.
const environment = processEnvironment();
await createServer(environment).connect(new StdioServerTransport());
environment.logger.info("mcp.started", { cwd: environment.cwd, envFile });
