/**
 * Langfuse tracing for one process. Only a tracer provider is registered:
 * the full OpenTelemetry Node SDK would ship unused exporters in the bundle.
 */
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  LangfuseVercelAiSdkIntegration,
  type LangfuseVercelAiSdkIntegrationOptions,
} from "@langfuse/vercel-ai-sdk";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry, type Telemetry } from "ai";

import { scrubbingProcessor, secretScrubber } from "#src/scrub-spans";

const DEFAULT_BASE_URL = "https://cloud.langfuse.com";

export interface Tracing {
  /** Never throws: a lost trace must not fail the work it traced. */
  flush(): Promise<void>;
  /** Masks these values in every span until the returned function runs; read at export, so the list can grow. */
  withSecrets(secrets: readonly (string | undefined)[]): () => void;
}

/** The AI SDK integration: every model call, tool call and payload becomes a span. */
export function createTelemetryIntegration(
  tracer?: LangfuseVercelAiSdkIntegrationOptions["tracer"],
): Telemetry {
  return new LangfuseVercelAiSdkIntegration({ tracer });
}

/** Starts span export when both Langfuse keys are set; undefined leaves tracing off. */
export function startTracing(
  env: Readonly<Record<string, string | undefined>>,
  logger: StructuredLogger,
): Tracing | undefined {
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim() ?? "";
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim() ?? "";
  if (publicKey === "" && secretKey === "") return undefined;
  if (publicKey === "" || secretKey === "") {
    logger.error("tracing.disabled_incomplete_credentials", {
      missing: publicKey === "" ? "LANGFUSE_PUBLIC_KEY" : "LANGFUSE_SECRET_KEY",
    });
    return undefined;
  }

  const spanProcessor = new LangfuseSpanProcessor({
    publicKey,
    secretKey,
    baseUrl: env.LANGFUSE_BASE_URL?.trim() || DEFAULT_BASE_URL,
    environment: env.LANGFUSE_ENVIRONMENT?.trim() || undefined,
    release: env.LANGFUSE_RELEASE?.trim() || undefined,
  });
  const scrubber = secretScrubber();
  new NodeTracerProvider({ spanProcessors: [scrubbingProcessor(spanProcessor, scrubber.scrub)] }).register();
  // From v7 the SDK emits spans only to a registered integration.
  registerTelemetry(createTelemetryIntegration());

  return {
    async flush() {
      try {
        await spanProcessor.forceFlush();
      } catch (error: unknown) {
        logger.error("tracing.flush_failed", { error: errorMessage(error) });
      }
    },
    withSecrets: scrubber.withSecrets,
  };
}
