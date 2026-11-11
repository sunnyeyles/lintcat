import { createLanguageModel, defaultModelFor, resolveModelProvider } from "@pr-review/ai";
import { db, modelKeyEncryptionKey, readModelKey, type Database } from "@pr-review/db";
import { createConsoleLogger, errorMessage } from "@pr-review/logging";

import { data } from "@/lib/data/server";
import { requireOrganization } from "@/lib/session";

import { handleTelemetryAgent } from "./handler";

// node:crypto and the Neon driver rule out the edge runtime.
export const runtime = "nodejs";

type Context = { params: Promise<{ slug: string }> };

async function organizationModel(database: Database, organizationId: number) {
  const key = await readModelKey(database, organizationId, modelKeyEncryptionKey());
  if (!key) return undefined;
  const provider = resolveModelProvider(key.provider);
  return createLanguageModel({ provider, apiKey: key.apiKey, modelId: defaultModelFor(provider) });
}

export async function POST(request: Request, { params }: Context): Promise<Response> {
  const { slug } = await params;
  // First, because locally db() is what loads .env.local.
  const database = db();
  const [{ session, organization }, source] = await Promise.all([requireOrganization(slug), data(slug)]);
  const logger = createConsoleLogger();
  let model;
  try {
    model = await organizationModel(database, organization.id);
  } catch (error) {
    logger.error("telemetry_agent.model_key_unusable", { organizationId: organization.id, error: errorMessage(error) });
    return Response.json({ error: "the organization's model key could not be used" }, { status: 503 });
  }
  return handleTelemetryAgent(request, {
    database,
    source,
    model,
    memberId: session.githubId,
    logger,
    now: () => new Date(),
  });
}
