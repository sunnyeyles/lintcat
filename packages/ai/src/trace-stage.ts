import {
  propagateAttributes,
  startActiveObservation,
  type PropagateAttributesParams,
} from "@langfuse/tracing";
import { errorName } from "@pr-review/logging";

type Level = "WARNING" | "ERROR";

export interface StageTrace<T> {
  output?: (result: T) => unknown;
  /** Flags a result that returned but still went wrong. */
  level?: (result: T) => Level | undefined;
  /** Trace-wide session, user and metadata, for a stage that opens its own trace. */
  attributes?: PropagateAttributesParams;
  /** Called only while a tracer is recording, so an unexported trace's id never reaches a log. */
  onTraceId?: (traceId: string) => void;
}

type Settled<T> = { ok: true; result: T } | { ok: false; error: unknown };

/** Runs one stage as a span; a no-op wrapper when no tracer is registered. */
export async function traceStage<T>(
  name: string,
  input: unknown,
  run: () => Promise<T> | T,
  options: StageTrace<T> = {},
): Promise<T> {
  const traced = () =>
    startActiveObservation(name, async (span): Promise<Settled<T>> => {
      if (span.otelSpan.isRecording()) options.onTraceId?.(span.traceId);
      span.update({ input });
      try {
        const result = await run();
        const level = options.level?.(result);
        span.update({ output: options.output?.(result), ...(level ? { level } : {}) });
        return { ok: true, result };
      } catch (error: unknown) {
        span.update({ level: "ERROR", statusMessage: errorName(error) });
        return { ok: false, error };
      }
    });
  // Langfuse exports a thrown error's raw message, which may hold a secret, so it is thrown outside.
  const settled = await (options.attributes ? propagateAttributes(options.attributes, traced) : traced());
  if (!settled.ok) throw settled.error;
  return settled.result;
}
