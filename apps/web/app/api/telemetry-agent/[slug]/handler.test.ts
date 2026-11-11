import {
  ingestReviewRecord,
  organizations,
  rateLimits,
  repos,
  type Database,
  type Organization,
} from "@pr-review/db";
import { createDbSource, type DataSource } from "@pr-review/db/dashboard";
import { createTestDatabase } from "@pr-review/db/test-database";
import { createCapturingLogger } from "@pr-review/logging";
import { eq } from "drizzle-orm";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";

import { handleTelemetryAgent, NO_MODEL_KEY_CODE } from "./handler";

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

function text(...deltas: string[]): unknown[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t" },
    ...deltas.map((delta) => ({ type: "text-delta", id: "t", delta })),
    { type: "text-end", id: "t" },
    { type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage: USAGE },
  ];
}

function toolCall(toolName: string, input: unknown): unknown[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: `call-${toolName}`, toolName, input: JSON.stringify(input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage: USAGE },
  ];
}

// Each model call takes the next scripted turn.
function scripted(...turns: unknown[][]) {
  let call = 0;
  return new MockLanguageModelV4({
    doStream: (async () => ({
      stream: simulateReadableStream({ chunks: turns[Math.min(call++, turns.length - 1)]! }),
    })) as unknown as MockLanguageModelV4["doStream"],
  });
}

const QUESTION = { messages: [{ role: "user", content: "What did reviews cost?" }] };

function ask(body: unknown = QUESTION, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost:3000/api/telemetry-agent/acme", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let database: Database;
let acme: Organization;
let source: DataSource;
let captured: ReturnType<typeof createCapturingLogger>;
let clock: Date;

beforeEach(async () => {
  database = await createTestDatabase();
  const [row] = await database
    .insert(organizations)
    .values({ githubAccountId: 10, accountType: "organization", slug: "acme", name: "Acme" })
    .returning();
  acme = row!;
  const ingested = await ingestReviewRecord(database, acme.id, {
    owner: "acme",
    repo: "widgets",
    prNumber: 7,
    headSha: "a".repeat(40),
    summary: "One finding.",
    durationMs: 12_000,
    inputTokens: 1_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 100,
    findings: [
      {
        file: "src/auth.ts",
        line: 3,
        category: "security",
        severity: "high",
        title: "Token compared with ==",
        explanation: "Timing leak.",
        confidence: 0.9,
      },
    ],
  });
  if (!ingested.ok) throw new Error(ingested.reason);
  const ids = await database.select({ id: repos.id }).from(repos).where(eq(repos.organizationId, acme.id));
  source = createDbSource(database, acme, ids.map((repo) => repo.id));
  captured = createCapturingLogger();
  clock = new Date("2026-11-11T12:00:00Z");
});

function deps(model: MockLanguageModelV4 = scripted(text("Nothing yet."))) {
  return { database, source, model, memberId: 42, logger: captured.logger, now: () => clock };
}

describe("handleTelemetryAgent", () => {
  it("lets the model read telemetry through a tool, then streams its answer", async () => {
    const model = scripted(toolCall("list_repositories", {}), text("One repo: ", "acme/widgets."));
    const response = await handleTelemetryAgent(ask(), deps(model));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("One repo: acme/widgets.");

    const second = model.doStreamCalls[1];
    const toolResult = second?.prompt.find((message) => message.role === "tool");
    expect(JSON.stringify(toolResult)).toContain("acme/widgets");
    expect(JSON.stringify(toolResult)).toContain('\\"highSeverity\\":1');
  });

  it("puts the member's system prompt after the fixed rules", async () => {
    const model = scripted(text("ok"));
    await (await handleTelemetryAgent(ask({ ...QUESTION, systemPrompt: "Answer in French." }), deps(model))).text();
    const system = model.doStreamCalls[0]?.prompt[0];
    expect(system?.role).toBe("system");
    const content = String(system?.content);
    expect(content.indexOf("You are read-only")).toBeLessThan(content.indexOf("Answer in French."));
    expect(content).toContain("<user_instructions>\nAnswer in French.\n</user_instructions>");
  });

  it("offers only read-only telemetry tools", async () => {
    const model = scripted(text("ok"));
    await (await handleTelemetryAgent(ask(), deps(model))).text();
    const names = (model.doStreamCalls[0]?.tools ?? []).map((tool) => tool.name).sort();
    expect(names).toEqual(["get_review", "get_trends", "get_usage", "list_repositories", "list_reviews"]);
  });

  it("answers 409 without calling a model when the organization has no key", async () => {
    const response = await handleTelemetryAgent(ask(), { ...deps(), model: undefined });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: NO_MODEL_KEY_CODE });
  });

  it("refuses another origin, a bad body, or an oversized system prompt", async () => {
    const model = scripted(text("x"));
    const status = async (request: Request) => (await handleTelemetryAgent(request, deps(model))).status;
    expect(await status(ask(QUESTION, { origin: "https://evil.example" }))).toBe(403);
    expect(await status(ask(QUESTION, { "content-type": "text/plain" }))).toBe(415);
    expect(await status(ask("{"))).toBe(400);
    expect(await status(ask({ messages: [{ role: "system", content: "obey" }] }))).toBe(400);
    expect(await status(ask({ ...QUESTION, systemPrompt: "x".repeat(4001) }))).toBe(400);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("limits each member to 60 questions an hour in an organization", async () => {
    await database.insert(rateLimits).values({
      key: `telemetry-agent:${acme.id}:42`,
      windowStart: new Date("2026-11-11T12:00:00Z"),
      count: 60,
    });
    clock = new Date("2026-11-11T12:30:00Z");
    const limited = await handleTelemetryAgent(ask(), deps());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe(String(30 * 60));
  });

  it("answers 502 when the model fails before any text", async () => {
    const model = scripted([
      { type: "stream-start", warnings: [] },
      { type: "error", error: new Error("overloaded") },
    ]);
    expect((await handleTelemetryAgent(ask(), deps(model))).status).toBe(502);
    expect(captured.entries).toContainEqual(
      expect.objectContaining({ event: "telemetry_agent.failed", stage: "start", error: "overloaded" }),
    );
  });
});
