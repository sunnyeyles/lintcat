import { startTracing, type Tracing } from "@pr-review/ai";
import type { StructuredLogger } from "@pr-review/logging";

let started = false;
let tracing: Tracing | undefined;

// Started on the first question, after db() has loaded .env.local, so no other page loads OpenTelemetry.
export function docsChatTracing(logger: StructuredLogger): Tracing | undefined {
  if (!started) {
    started = true;
    tracing = startTracing(process.env, logger, "web");
  }
  return tracing;
}
