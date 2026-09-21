/**
 * Langfuse tracing for one action run. Only a tracer provider is registered:
 * the full OpenTelemetry Node SDK would ship unused exporters in the bundle.
 */
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  LangfuseVercelAiSdkIntegration,
  type LangfuseVercelAiSdkIntegrationOptions,
} from "@langfuse/vercel-ai-sdk";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry, type Telemetry } from "ai";

export interface LangfuseRuntimeConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
  environment?: string | undefined;
  release?: string | undefined;
  /** Export prompts, completions and tool payloads; off means timings and counts only. */
  recordIo?: boolean | undefined;
}

export interface LangfuseRuntime {
  forceFlush(): Promise<void>;
}

export interface TelemetryIntegrationOptions {
  recordIo: boolean;
  tracer?: LangfuseVercelAiSdkIntegrationOptions["tracer"];
}

const NO_PAYLOADS = { recordInputs: false, recordOutputs: false };

/** The AI SDK integration, stripped of payloads unless `recordIo` is set. */
export function createTelemetryIntegration(
  options: TelemetryIntegrationOptions,
): Telemetry {
  const integration = new LangfuseVercelAiSdkIntegration({
    tracer: options.tracer,
  });
  return options.recordIo ? integration : withoutPayloads(integration);
}

// The SDK records both by default and passes the flags on each event, so
// forcing them here covers every call, whatever its own telemetry options say.
function withoutPayloads(integration: Telemetry): Telemetry {
  return new Proxy(integration, {
    get(target, key) {
      const member: unknown = Reflect.get(target, key);
      if (typeof member !== "function") return member;
      if (typeof key !== "string" || !key.startsWith("on") || key === "onError") {
        return member.bind(target);
      }
      return (event: object) =>
        member.call(
          target,
          Object.assign(Object.create(Object.getPrototypeOf(event)), event, NO_PAYLOADS),
        );
    },
  });
}

/** Starts span export for this process and returns its flush handle. */
export function createLangfuseRuntime(
  config: LangfuseRuntimeConfig,
): LangfuseRuntime {
  const spanProcessor = new LangfuseSpanProcessor({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.baseUrl,
    environment: config.environment,
    release: config.release,
  });

  new NodeTracerProvider({ spanProcessors: [spanProcessor] }).register();
  // From v7 the SDK emits spans only to a registered integration.
  registerTelemetry(
    createTelemetryIntegration({ recordIo: config.recordIo === true }),
  );

  return {
    async forceFlush() {
      await spanProcessor.forceFlush();
    },
  };
}
