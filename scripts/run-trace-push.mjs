#!/usr/bin/env node
// Claude Code hook: pushes changed transcript files to /dev/run-trace.
// Needs RUN_TRACE_URL and RUN_TRACE_TOKEN; does nothing without them.
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const DEBOUNCE_MS = 2500;
const FINAL_EVENTS = new Set(["Stop", "SubagentStop", "SessionEnd"]);
const STATE_DIR = path.join(tmpdir(), "lintcat-run-trace");

/** The files to send: each listed file whose mtime differs from the last send. */
export function changedFiles(entries, sentMtimes) {
  return entries.filter((entry) => sentMtimes[entry.name] !== entry.mtimeMs);
}

export function shouldSend(event, lastSentAt, now) {
  return FINAL_EVENTS.has(event) || now - lastSentAt >= DEBOUNCE_MS;
}

/** Main transcript plus `<sid>/subagents/agent-*` beside it, named as the server expects. */
export async function listTraceFiles(transcriptPath, sessionId) {
  const files = [{ name: `${sessionId}.jsonl`, path: transcriptPath }];
  const dir = path.join(path.dirname(transcriptPath), sessionId, "subagents");
  const names = await readdir(dir).catch(() => []);
  for (const name of names.sort()) {
    if (/^agent-[\w-]+\.(jsonl|meta\.json)$/.test(name)) {
      files.push({ name: `${sessionId}/subagents/${name}`, path: path.join(dir, name) });
    }
  }
  const withTimes = await Promise.all(
    files.map(async (file) => ({ ...file, mtimeMs: (await stat(file.path).catch(() => null))?.mtimeMs })),
  );
  return withTimes.filter((file) => file.mtimeMs !== undefined);
}

async function readState(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return { lastSentAt: 0, mtimes: {} };
  }
}

async function send({ session_id: sessionId, transcript_path: transcriptPath, hook_event_name: event }) {
  const url = process.env.RUN_TRACE_URL;
  const token = process.env.RUN_TRACE_TOKEN;
  if (!url || !token || !sessionId || !transcriptPath) return;
  if (!/^[\w-]+$/.test(sessionId)) return;

  await mkdir(STATE_DIR, { recursive: true });
  const stateFile = path.join(STATE_DIR, `${sessionId}.json`);
  const state = await readState(stateFile);
  const now = Date.now();
  if (!shouldSend(event, state.lastSentAt, now)) return;
  await writeFile(stateFile, JSON.stringify({ ...state, lastSentAt: now }));

  const changed = changedFiles(await listTraceFiles(transcriptPath, sessionId), state.mtimes);
  if (changed.length === 0) return;
  const files = await Promise.all(
    changed.map(async (file) => ({ name: file.name, text: await readFile(file.path, "utf8") })),
  );

  const response = await fetch(`${url.replace(/\/$/, "")}/api/run-trace/${sessionId}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "content-encoding": "gzip",
    },
    body: gzipSync(JSON.stringify({ files })),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return;

  const latest = await readState(stateFile);
  for (const file of changed) latest.mtimes[file.name] = file.mtimeMs;
  await writeFile(stateFile, JSON.stringify(latest));
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--send") {
    await send(JSON.parse(process.argv[3])).catch(() => {});
  } else {
    // Detaches the upload so the hook returns at once and never slows the run.
    const input = JSON.parse((await readStdin().catch(() => "")) || "{}");
    const { session_id, transcript_path, hook_event_name } = input;
    const args = JSON.stringify({ session_id, transcript_path, hook_event_name });
    const child = spawn(process.execPath, [process.argv[1], "--send", args], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}
