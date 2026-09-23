import { consumeRateLimit, type Database } from "@pr-review/db";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import { streamText, type LanguageModel } from "ai";
import { z } from "zod";

import { clientAddress, rateLimitKey } from "@/lib/docs-chat/client-key";
import {
  GLOBAL_RULE,
  IP_RULE,
  MAX_ASSISTANT_CHARS,
  MAX_BODY_BYTES,
  MAX_MESSAGES,
  MAX_OUTPUT_TOKENS,
  MAX_USER_CHARS,
} from "@/lib/docs-chat/limits";
import { DOCS_CHAT_SYSTEM_PROMPT } from "@/lib/docs-chat/system-prompt";

const requestSchema = z.object({
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

export type DocsChatDeps = {
  database: Database;
  model: LanguageModel;
  secret: string;
  logger: StructuredLogger;
  now: () => Date;
};

// Anthropic honours this on the system prompt; the docs prefix is identical on every request.
const CACHE_BREAKPOINT = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

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

function tooManyRequests(scope: "client" | "global", resetAt: Date, now: Date): Response {
  const seconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
  return Response.json(
    { error: "too many questions; try again later", scope },
    { status: 429, headers: { "retry-after": String(seconds) } },
  );
}

/** The route body, with its collaborators passed in so tests need no `db()` or API key. */
export async function handleDocsChat(request: Request, deps: DocsChatDeps): Promise<Response> {
  const { database, logger } = deps;
  if (!sameOrigin(request)) {
    return Response.json({ error: "cross-origin requests are not allowed" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "send application/json" }, { status: 415 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "request is too large" }, { status: 413 });
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
  const { messages } = parsed.data;

  const started = deps.now();
  const client = clientAddress(request.headers);
  const perClient = await consumeRateLimit(database, {
    ...IP_RULE,
    key: rateLimitKey(client.address, deps.secret),
    now: started,
  });
  if (!perClient.allowed) {
    logger.info("docs_chat.rate_limited", { scope: "client", ipSource: client.source });
    return tooManyRequests("client", perClient.resetAt, started);
  }
  const global = await consumeRateLimit(database, { ...GLOBAL_RULE, key: "docs-chat:global", now: started });
  if (!global.allowed) {
    logger.info("docs_chat.rate_limited", { scope: "global", ipSource: client.source });
    return tooManyRequests("global", global.resetAt, started);
  }

  const result = streamText({
    model: deps.model,
    instructions: { role: "system", content: DOCS_CHAT_SYSTEM_PROMPT, providerOptions: CACHE_BREAKPOINT },
    messages,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    abortSignal: request.signal,
    telemetry: { functionId: "docs-chat" },
    // Errors surface as stream parts, logged below; the default handler would print them again.
    onError: () => {},
    onFinish: ({ totalUsage, finishReason }) => {
      logger.info("docs_chat.completed", {
        durationMs: deps.now().getTime() - started.getTime(),
        turns: messages.length,
        ipSource: client.source,
        finishReason,
        inputTokens: totalUsage.inputTokens,
        cacheReadTokens: totalUsage.inputTokenDetails.cacheReadTokens,
        cacheWriteTokens: totalUsage.inputTokenDetails.cacheWriteTokens,
        outputTokens: totalUsage.outputTokens,
      });
    },
  });
  const parts = result.stream[Symbol.asyncIterator]();

  // Wait for the first text so a failure before it is a real error status, not an empty answer.
  let first: string | undefined;
  try {
    while (first === undefined) {
      const next = await parts.next();
      if (next.done) throw new Error("the model returned no text");
      if (next.value.type === "error") throw next.value.error;
      if (next.value.type === "text-delta") first = next.value.text;
    }
  } catch (error) {
    logger.error("docs_chat.failed", { stage: "start", error: errorMessage(error) });
    return Response.json({ error: "the assistant is unavailable right now" }, { status: 502 });
  }

  const encoder = new TextEncoder();
  let cancelled = false;
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
          if (next.value.type === "text-delta") return controller.enqueue(encoder.encode(next.value.text));
        }
      } catch (error) {
        if (cancelled) return;
        logger.error("docs_chat.failed", { stage: "stream", error: errorMessage(error) });
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
