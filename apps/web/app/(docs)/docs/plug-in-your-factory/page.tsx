import {
  Card,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pr-review/design";
import type { Metadata } from "next";

import { Bullet, Bullets, Code, DocsArticle, Note, P, Section } from "@/components/docs";
import type { Heading } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Plug in your factory",
  description: "Show any agent factory's runs in the run-trace dashboard, from the files it already writes.",
  alternates: { canonical: "/docs/plug-in-your-factory" },
};

const HEADINGS: Heading[] = [
  { id: "formats", title: "Supported formats" },
  { id: "run-format", title: "The lintcat run format" },
  { id: "drop", title: "Drop a file" },
  { id: "push", title: "Push over HTTP" },
  { id: "pull", title: "Pull from a database" },
  { id: "limits", title: "Limits and safety" },
];

const FORMATS = [
  ["claude-code", "Claude Code / Agent SDK", "A session's .jsonl transcript, with its subagents/ folder beside it."],
  ["otel-genai", "OpenTelemetry GenAI spans", "An OTLP JSON export (resourceSpans), one document or one per line. invoke_agent spans become agents, chat and execute_tool spans become steps, parent span IDs build the tree."],
  ["openai-agents", "OpenAI Agents SDK", "A traces/spans export: objects with \"object\": \"trace\" or \"trace.span\". Agent spans become agents; generation, function, handoff and guardrail spans become steps."],
  ["lintcat", "lintcat run format", "The small NDJSON event stream below, for anything else."],
  ["lintcat-factory", "lintcat factory", "A factory-run.json export, or a .factory/runs/<id>/ folder with events.jsonl. One agent per stage and agent, commands and checks as steps."],
] as const;

const EVENTS = [
  ["run_started", "run, title?", "Names the run. Optional: without it, top agents sit under a synthetic root."],
  ["agent_started", "agent, role, parent?, description?, model?, stage?, prompt?", "Starts an agent; parent nests it under another."],
  ["step", "agent, kind (prompt | thinking | text), text", "Something the agent was told, thought or said."],
  ["tool_call", "agent, id, name, input?, summary?, output?, error?, files?", "A tool call; output may come here or later."],
  ["tool_result", "agent, id, output?, error?", "The result of an earlier tool_call with the same id."],
  ["event", "agent, name, category?, status?, text?, output?, durationMs?", "A non-LLM step: a shell command, a check, a handoff, a log line."],
  ["usage", "agent, inputTokens, outputTokens?, costUsd?", "One model turn's usage; inputTokens draws the context chart."],
  ["agent_finished", "agent, status (done | failed | cancelled), error?", "Ends an agent. Without it the agent shows as running."],
  ["run_finished", "status?, summary?, blocker?, url?", "The run's outcome, shown above the timeline."],
] as const;

const EXAMPLE = `{"v":1,"at":"2026-11-10T09:00:00Z","type":"run_started","run":"nightly-docs-42","title":"Refresh API docs"}
{"v":1,"at":"2026-11-10T09:00:00Z","type":"agent_started","agent":"lead","role":"lead","model":"claude-sonnet-4-5","prompt":"Regenerate API docs and open a PR"}
{"v":1,"at":"2026-11-10T09:00:05Z","type":"tool_call","agent":"lead","id":"writer","name":"spawn","summary":"writer: draft pages"}
{"v":1,"at":"2026-11-10T09:00:05Z","type":"agent_started","agent":"writer","parent":"lead","role":"writer","stage":"write"}
{"v":1,"at":"2026-11-10T09:00:09Z","type":"tool_call","agent":"writer","id":"c1","name":"read_file","input":{"path":"src/api.ts"},"files":{"read":["src/api.ts"]}}
{"v":1,"at":"2026-11-10T09:00:10Z","type":"tool_result","agent":"writer","id":"c1","output":"export function createUser() {}"}
{"v":1,"at":"2026-11-10T09:00:12Z","type":"usage","agent":"writer","inputTokens":5200,"outputTokens":400,"costUsd":0.021}
{"v":1,"at":"2026-11-10T09:00:35Z","type":"event","agent":"writer","name":"markdownlint","category":"check","status":"error","text":"2 warnings","durationMs":1800}
{"v":1,"at":"2026-11-10T09:00:40Z","type":"agent_finished","agent":"writer","status":"done"}
{"v":1,"at":"2026-11-10T09:00:41Z","type":"tool_result","agent":"lead","id":"writer","output":"Drafted docs/api.md"}
{"v":1,"at":"2026-11-10T09:00:48Z","type":"agent_finished","agent":"lead","status":"done"}
{"v":1,"at":"2026-11-10T09:00:49Z","type":"run_finished","status":"delivered","summary":"Docs refreshed"}`;

const CURL = `curl -X POST "$RUN_TRACE_URL/api/run-trace/my-run-1" \\
  -H "authorization: Bearer $RUN_TRACE_TOKEN" \\
  -H "content-type: application/json" \\
  -d "$(jq -n --rawfile text run.ndjson '{files: [{name: "run.ndjson", text: $text}]}')"`;

const NODE = `const events = [];
async function emit(event) {
  events.push(JSON.stringify({ v: 1, at: new Date().toISOString(), ...event }));
  await fetch(\`\${process.env.RUN_TRACE_URL}/api/run-trace/my-run-1\`, {
    method: "POST",
    headers: { authorization: \`Bearer \${process.env.RUN_TRACE_TOKEN}\`, "content-type": "application/json" },
    body: JSON.stringify({ format: "lintcat", files: [{ name: "run.ndjson", text: events.join("\\n") }] }),
  });
}

await emit({ type: "agent_started", agent: "main", role: "planner" });
await emit({ type: "agent_finished", agent: "main", status: "done" });`;

const PYTHON = `import json, os, urllib.request
from datetime import datetime, timezone

events = []
def emit(**event):
    events.append(json.dumps({"v": 1, "at": datetime.now(timezone.utc).isoformat(), **event}))
    body = json.dumps({"format": "lintcat", "files": [{"name": "run.ndjson", "text": "\\n".join(events)}]})
    urllib.request.urlopen(urllib.request.Request(
        f"{os.environ['RUN_TRACE_URL']}/api/run-trace/my-run-1", data=body.encode(), method="POST",
        headers={"authorization": f"Bearer {os.environ['RUN_TRACE_TOKEN']}", "content-type": "application/json"}))

emit(type="agent_started", agent="main", role="worker")
emit(type="agent_finished", agent="main", status="done")`;

const PULL = `# .env.local for apps/web: read runs straight from the factory's Postgres
FACTORY_DATABASE_URL=postgres://user:password@localhost:5432/factory
RUN_TRACE_TOKEN=any-long-random-string`;

const RESPONSES = `200 {"ok":true,"format":"lintcat","files":1}
400 {"error":"unknown format \\"x\\"","supported":["claude-code","otel-genai","openai-agents","lintcat","lintcat-factory"]}
404 a missing or wrong token, so the endpoint does not advertise itself
413 a body over 64 MB`;

export default function PlugInYourFactoryPage() {
  return (
    <DocsArticle
      href="/docs/plug-in-your-factory"
      eyebrow="Reference"
      title="Plug in your factory"
      description="The run-trace dashboard at /dev/run-trace shows any agent factory's runs: every agent, what it did, and how its run ended. Hand it the files your factory already writes; no code changes."
      headings={HEADINGS}
    >
      <Section id="formats" title="Supported formats">
        <P>
          Each format has an adapter. The dashboard reads what you give it, picks the adapter that
          fits best, shows which one it used, and lets you override it.
        </P>
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">The run formats the dashboard reads.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Format id</TableHead>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">What to hand over</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FORMATS.map(([id, name, what]) => (
                <TableRow key={id}>
                  <TableCell className="font-mono text-foreground">{id}</TableCell>
                  <TableCell className="text-foreground">{name}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{what}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section id="run-format" title="The lintcat run format">
        <P>
          For any factory the other formats don&rsquo;t cover. Write one JSON object per line. Every
          event has <code>type</code> and <code>at</code> (an ISO 8601 timestamp with a zone), and may
          carry <code>&quot;v&quot;: 1</code>. Lines that don&rsquo;t validate are skipped, not fatal,
          and events may arrive in any order. Validate against the{" "}
          <a href="/schemas/lintcat-run-format.schema.json" className="text-link underline">
            JSON Schema
          </a>
          ; the Zod source is <code>runEventSchema</code> in <code>@pr-review/schemas</code>.
        </P>
        <Card className="py-0">
          <Table>
            <TableCaption className="sr-only">The lintcat run format event types.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">type</TableHead>
                <TableHead scope="col">Fields</TableHead>
                <TableHead scope="col">Meaning</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EVENTS.map(([type, fields, meaning]) => (
                <TableRow key={type}>
                  <TableCell className="font-mono text-foreground">{type}</TableCell>
                  <TableCell className="whitespace-normal font-mono text-label text-muted-foreground">{fields}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{meaning}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Code caption="run.ndjson">{EXAMPLE}</Code>
        <Note title="Linking a spawn">
          A tool_call whose id equals a child agent&rsquo;s id gets an &ldquo;Open&rdquo; link to that
          agent, as the writer above does.
        </Note>
      </Section>

      <Section id="drop" title="Drop a file">
        <P>
          Open <code>/dev/run-trace</code> and drop a folder, one or more <code>.json</code>,{" "}
          <code>.jsonl</code> or <code>.ndjson</code> files, or a <code>.zip</code> of a folder. Or use
          Choose folder and Choose files. Everything is read in your browser; nothing is uploaded.
        </P>
      </Section>

      <Section id="push" title="Push over HTTP">
        <P>
          Set <code>RUN_TRACE_TOKEN</code> on the web app, then POST{" "}
          <code>{"{ format?, files: [{ name, text }] }"}</code> to <code>/api/run-trace/&lt;runId&gt;</code>{" "}
          with that token as a bearer. Leave out <code>format</code> to auto-detect. Push again as the
          run grows: a file with the same name replaces the last copy, and the run page refreshes every
          few seconds while pushes keep arriving. A gzipped body with{" "}
          <code>content-encoding: gzip</code> also works.
        </P>
        <Code caption="curl">{CURL}</Code>
        <Code caption="Node">{NODE}</Code>
        <Code caption="Python">{PYTHON}</Code>
        <Code caption="Responses">{RESPONSES}</Code>
        <P>
          Runnable versions are in <code>scripts/run-trace-examples/</code>. For Claude Code,{" "}
          <code>scripts/run-trace-push.mjs</code> pushes a session as a hook.
        </P>
      </Section>

      <Section id="pull" title="Pull from a database">
        <P>
          A connector is a source the web app reads itself. The lintcat factory connector reads{" "}
          <code>factory_runs</code>, <code>factory_events</code> and <code>factory_commands</code>{" "}
          read-only. It is off until <code>FACTORY_DATABASE_URL</code> is set; then the factory&rsquo;s
          runs appear beside pushed ones and update live.
        </P>
        <Code caption=".env.local">{PULL}</Code>
        <P>
          To add a source, implement <code>RunTraceConnector</code> (<code>list</code> and{" "}
          <code>read</code>, in <code>apps/web/lib/run-trace/connectors/</code>) and return files in any
          supported format.
        </P>
      </Section>

      <Section id="limits" title="Limits and safety">
        <Bullets>
          <Bullet>Up to 500 files and 64 MB per push or drop; zips are capped by their expanded size.</Bullet>
          <Bullet>Each format is validated with a schema; records that fail are skipped.</Bullet>
          <Bullet>Nothing in a trace is ever run. Text is shown as text.</Bullet>
          <Bullet>
            A file that matches no format gets a message naming what is supported, not an error page.
          </Bullet>
        </Bullets>
      </Section>
    </DocsArticle>
  );
}
