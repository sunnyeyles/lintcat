import { consumeRateLimit, type Database } from "@pr-review/db";
import type { DataSource } from "@pr-review/db/dashboard";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import { isStepCount, streamText, type LanguageModel } from "ai";
import { z } from "zod";

import {
  MAX_ASSISTANT_CHARS,
  MAX_BODY_BYTES,
  MAX_MESSAGES,
  MAX_OUTPUT_TOKENS,
  MAX_STEPS,
  MAX_SYSTEM_PROMPT_CHARS,
  MAX_USER_CHARS,
  MEMBER_RULE,
} from "@/lib/telemetry-agent/limits";
import { buildSystemPrompt } from "@/lib/telemetry-agent/system-prompt";
import { createTelemetryTools } from "@/lib/telemetry-agent/tools";

export const NO_MODEL_KEY_CODE = "no-model-key";

const requestSchema = z.object({
  systemPrompt: z.string().max(MAX_SYSTEM_PROMPT_CHARS).optional(),
  messages: z
    .array(
      z.discriminatedUnion("role", [
        z.object({ role: z.literal("user"), content: z.string().trim().min(1).max(MAX_USER_CHARS) }),
        z.object({ role: z.literal("assistant"), content: z.string().trim().min(1).max(MAX_ASSISTANT_CHARS) }),
      ]),
    )
    .min(1)
    .max(MAX_MESSAGES)
    .refine(
      (messages) =>
        messages.length % 2 === 1 &&
        messages.every((message, i) => message.role === (i % 2 === 0 ? "user" : "assistant")),
      "turns must alternate, starting and ending with the user",
    ),
});

export type TelemetryAgentDeps = {
  database: Database;
  source: DataSource;
  /** Undefined when the organization has no model key to run on. */
  model: LanguageModel | undefined;
  memberId: number;
  logger: StructuredLogger;
  now: () => Date;
};

const FINAL_STEP_NUDGE = "Stop calling tools and answer now from what you have read.";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The route body, with its collaborators passed in so tests need no session, `db()` or key. */
export async function handleTelemetryAgent(request: Request, deps: TelemetryAgentDeps): Promise<Response> {
  const { database, source, logger } = deps;
  if (!sameOrigin(request)) {
    return Response.json({ error: "cross-origin requests are not allowed" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "send application/json" }, { status: 415 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "request is too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body is not valid JSON" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid question", issues: parsed.error.issues }, { status: 400 });
  }
  if (!deps.model) {
    return Response.json(
      { error: "this organization has no model key", code: NO_MODEL_KEY_CODE },
      { status: 409 },
    );
  }

  const started = deps.now();
  const organizationId = source.organization.id;
  const limit = await consumeRateLimit(database, {
    ...MEMBER_RULE,
    key: `telemetry-agent:${organizationId}:${deps.memberId}`,
    now: started,
  });
  if (!limit.allowed) {
    const seconds = Math.max(1, Math.ceil((limit.resetAt.getTime() - started.getTime()) / 1000));
    logger.info("telemetry_agent.rate_limited", { organizationId });
    return Response.json(
      { error: "too many questions; try again later" },
      { status: 429, headers: { "retry-after": String(seconds) } },
    );
  }

  const { messages, systemPrompt } = parsed.data;
  let steps = 0;
  const result = streamText({
    model: deps.model,
    instructions: buildSystemPrompt(source.organization.slug, systemPrompt),
    messages,
    tools: createTelemetryTools(source),
    stopWhen: isStepCount(MAX_STEPS),
    prepareStep: ({ stepNumber, messages: sofar }) =>
      stepNumber === MAX_STEPS - 1
        ? { toolChoice: "none" as const, messages: [...sofar, { role: "user" as const, content: FINAL_STEP_NUDGE }] }
        : undefined,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    abortSignal: request.signal,
    telemetry: { functionId: "telemetry-agent" },
    // Errors surface as stream parts, logged below; the default handler would print them again.
    onError: () => {},
    onStepEnd: () => {
      steps += 1;
    },
    onFinish: ({ totalUsage, finishReason }) => {
      logger.info("telemetry_agent.completed", {
        organizationId,
        durationMs: deps.now().getTime() - started.getTime(),
        turns: messages.length,
        customPrompt: Boolean(systemPrompt?.trim()),
        steps,
        finishReason,
        inputTokens: totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens,
      });
    },
  });
  const parts = result.stream[Symbol.asyncIterator]();

  // Wait for the first text so a failure before it, tool calls included, is a real error status.
  let first: string | undefined;
  try {
    while (first === undefined) {
      const next = await parts.next();
      if (next.done) throw new Error("the model returned no text");
      if (next.value.type === "error") throw next.value.error;
      if (next.value.type === "text-delta") first = next.value.text;
    }
  } catch (error) {
    logger.error("telemetry_agent.failed", { organizationId, stage: "start", error: errorMessage(error) });
    return Response.json({ error: "the agent is unavailable right now" }, { status: 502 });
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  // Text from separate steps would otherwise run together mid-sentence.
  let gap = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(first));
    },
    async pull(controller) {
      try {
        for (;;) {
          const next = await parts.next();
          if (cancelled) return;
          if (next.done) return controller.close();
          if (next.value.type === "error") throw next.value.error;
          if (next.value.type === "text-start") gap = true;
          if (next.value.type === "text-delta" && next.value.text) {
            const text = gap ? `\n\n${next.value.text}` : next.value.text;
            gap = false;
            return controller.enqueue(encoder.encode(text));
          }
        }
      } catch (error) {
        if (cancelled) return;
        logger.error("telemetry_agent.failed", { organizationId, stage: "stream", error: errorMessage(error) });
        controller.error(error);
      }
    },
    async cancel() {
      cancelled = true;
      await parts.return?.();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
