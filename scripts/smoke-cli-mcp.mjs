// Smoke-tests the cli and mcp bundles: each must start, answer, and exit without network or a model.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliBundle = path.join(repoRoot, "apps", "cli", "dist", "index.mjs");
const mcpBundle = path.join(repoRoot, "apps", "mcp", "dist", "index.mjs");

const requiredMcpTools = ["review_local_changes", "search_code", "find_references"];
const mcpTimeoutMs = 15_000;

const failures = [];
const fail = (message) => failures.push(message);

// No keys or tokens reach either bundle, so nothing it does can call out.
function scrubbedEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/(_API_KEY|_TOKEN|_SECRET|DATABASE_URL)$/.test(key)) continue;
    if (/^(GITHUB_|INPUT_|ACTIONS_|RUNNER_)/.test(key)) continue;
    env[key] = value;
  }
  return env;
}

const workDir = mkdtempSync(path.join(tmpdir(), "pr-review-smoke-"));

function runCli(args) {
  return spawnSync(process.execPath, [cliBundle, ...args], {
    cwd: workDir,
    env: scrubbedEnv(),
    encoding: "utf8",
    timeout: 30_000,
  });
}

function smokeCli() {
  console.log("\ncli bundle");
  const version = runCli(["version"]);
  if (version.status !== 0 || !/^\d+\.\d+\.\d+/.test(version.stdout.trim())) {
    fail(
      `cli version: expected exit 0 and a semver, got exit ${version.status}\n` +
        `stdout: ${version.stdout}\nstderr: ${version.stderr}`,
    );
  } else {
    console.log(`  version prints ${version.stdout.trim()}`);
  }

  const help = runCli(["help"]);
  if (help.status !== 0 || !help.stdout.includes("pr-review")) {
    fail(`cli help: expected exit 0 and usage text, got exit ${help.status}\nstderr: ${help.stderr}`);
  } else {
    console.log("  help prints usage");
  }
}

function frame(id, method, params = {}) {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

// Speaks just enough MCP over stdio to list the tools, then closes stdin.
function smokeMcp() {
  console.log("\nmcp bundle");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [mcpBundle], {
      cwd: workDir,
      env: scrubbedEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let tools = null;
    let settled = false;

    const finish = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (message !== undefined) fail(message);
      child.kill("SIGTERM");
      resolve();
    };
    const timer = setTimeout(() => {
      finish(`mcp: no tools/list answer within ${mcpTimeoutMs}ms\nstderr: ${stderr}`);
    }, mcpTimeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(`mcp: could not spawn: ${error.message}`));
    child.on("exit", (code) => {
      if (tools === null) finish(`mcp: exited (code ${code}) before answering\nstderr: ${stderr}`);
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf("\n")) !== -1) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (line === "") continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          finish(`mcp: stdout carried a non-protocol line: ${line}`);
          return;
        }
        if (message.id === 1) {
          if (message.error !== undefined) {
            finish(`mcp initialize failed: ${JSON.stringify(message.error)}`);
            return;
          }
          console.log(`  initialize answered by ${message.result?.serverInfo?.name ?? "unknown"}`);
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
          );
          child.stdin.write(frame(2, "tools/list"));
        } else if (message.id === 2) {
          tools = (message.result?.tools ?? []).map((tool) => tool.name);
          const missing = requiredMcpTools.filter((name) => !tools.includes(name));
          if (missing.length > 0) {
            finish(`mcp tools/list is missing ${missing.join(", ")} (saw: ${tools.join(", ")})`);
            return;
          }
          console.log(`  tools/list returned ${tools.length} tools`);
          child.stdin.end();
          finish();
        }
      }
    });

    child.stdin.write(
      frame(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "0.0.0" },
      }),
    );
  });
}

try {
  smokeCli();
  await smokeMcp();
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("\ncli/mcp smoke check FAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\ncli/mcp smoke check passed.");
