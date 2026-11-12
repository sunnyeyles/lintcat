#!/usr/bin/env node
// Emits a lintcat run format stream and pushes it while the run works.
// Usage: RUN_TRACE_URL=… RUN_TRACE_TOKEN=… node push.mjs
const url = process.env.RUN_TRACE_URL;
const token = process.env.RUN_TRACE_TOKEN;
const runId = `demo-${Date.now()}`;
const events = [];

async function emit(event) {
  events.push(JSON.stringify({ v: 1, at: new Date().toISOString(), ...event }));
  const response = await fetch(`${url}/api/run-trace/${runId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ format: "lintcat", files: [{ name: "run.ndjson", text: events.join("\n") }] }),
  });
  if (!response.ok) throw new Error(`push failed: ${response.status} ${await response.text()}`);
}

await emit({ type: "run_started", run: runId, title: "Demo run" });
await emit({ type: "agent_started", agent: "main", role: "planner", prompt: "Say hello" });
await emit({ type: "tool_call", agent: "main", id: "t1", name: "shell", input: { command: "echo hello" } });
await emit({ type: "tool_result", agent: "main", id: "t1", output: "hello" });
await emit({ type: "usage", agent: "main", inputTokens: 1200, outputTokens: 40 });
await emit({ type: "agent_finished", agent: "main", status: "done" });
await emit({ type: "run_finished", status: "delivered", summary: "Said hello" });
console.log(`${url}/dev/run-trace/${runId}`);
