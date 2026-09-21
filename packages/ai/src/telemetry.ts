import type { TelemetryOptions } from "ai";

/** Span settings for one model call; payloads stay out unless asked for. */
export function callTelemetry(
  functionId: string,
  recordPayloads = false,
): TelemetryOptions {
  return {
    functionId,
    recordInputs: recordPayloads,
    recordOutputs: recordPayloads,
  };
}
