#!/usr/bin/env node
// Drives `factory mcp` over real stdio with the SDK client; no model, no Docker. Not part of `pnpm test`.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.argv[2] ?? mkdtempSync(path.join(tmpdir(), "factory-mcp-smoke-"));
mkdirSync(repo, { recursive: true });
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("config", "user.name", "Factory smoke");
git("config", "user.email", "smoke@example.invalid");
writeFileSync(path.join(repo, "cli.js"), "console.log('hi');\n");
git("add", "-A");
git("commit", "-qm", "init");

const smokeSpec = {
  title: "Add a --version flag",
  objective: "Print the package version",
  category: "quick",
  requirements: ["--version prints the version"],
  nonGoals: [],
  constraints: [],
  acceptanceCriteria: [{ id: "AC1", text: "Given the CLI, when run with --version, then it prints the version", verification: "automated" }],
  plan: ["Edit cli.js"],
  architectureDecisions: [],
  repositoryFindings: [],
  assumptions: [],
  estimatedFiles: 1,
  risk: "low",
  touchesSecurityOrData: false,
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, "..", "start.mjs"), "mcp"],
  cwd: repo,
  stderr: "inherit",
});
const client = new Client({ name: "factory-smoke", version: "0" });
await client.connect(transport);

const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
};
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, data: result.structuredContent ?? {}, text: result.content?.[0]?.text ?? "" };
};

const { tools } = await client.listTools();
check(tools.length === 7, `7 tools: ${tools.map((t) => t.name).join(", ")}`);
const started = await call("factory_start", { repoPath: repo, spec: smokeSpec });
check(!started.isError && started.data.runId, `factory_start -> ${started.data.runId}`);
const status = await call("factory_status", { runId: started.data.runId });
check(status.data.run?.status === "awaiting_approval", `factory_status -> ${status.data.run?.status}`);
const task = await call("factory_read_task", { runId: started.data.runId });
check(task.text.includes(smokeSpec.title), "factory_read_task renders the proposed spec");
const cancelled = await call("factory_cancel", { runId: started.data.runId });
check(cancelled.data.outcome === "cancelled", `factory_cancel -> ${cancelled.data.outcome}`);
const missing = await call("factory_status", { runId: "r-missing" });
check(missing.isError, "unknown run id is a tool error");
await client.close();
console.log(`repo: ${repo}`);
