import { createAnthropic } from "@ai-sdk/anthropic";
import { db, pruneRateLimits } from "@pr-review/db";
import { createConsoleLogger } from "@pr-review/logging";
import { after } from "next/server";

import { DOCS_CHAT_MODEL } from "@/lib/docs-chat/system-prompt";
import { docsChatTracing } from "@/lib/docs-chat/tracing";

import { handleDocsChat } from "./handler";

// node:crypto and the Neon driver rule out the edge runtime.
export const runtime = "nodejs";

const PRUNE_AFTER_MS = 2 * 86_400_000;

export function POST(request: Request): Promise<Response> | Response {
  // First, because locally db() is what loads .env.local.
  const database = db();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const secret = process.env.AUTH_SECRET;
  if (!apiKey || !secret) {
    return Response.json({ error: "docs chat is not configured" }, { status: 503 });
  }
  const logger = createConsoleLogger();
  const tracing = docsChatTracing(logger);
  after(() => pruneRateLimits(database, new Date(Date.now() - PRUNE_AFTER_MS)));
  // Runs once the streamed answer has finished, so its trace has ended.
  if (tracing) after(() => tracing.flush());
  return handleDocsChat(request, {
    database,
    model: createAnthropic({ apiKey })(DOCS_CHAT_MODEL),
    secret,
    logger,
    now: () => new Date(),
  });
}
