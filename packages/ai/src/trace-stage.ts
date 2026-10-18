import {
  propagateAttributes,
  startActiveObservation,
  type PropagateAttributesParams,
} from "@langfuse/tracing";
import { errorMessage } from "@pr-review/logging";

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

/** Runs one stage as a span; a no-op wrapper when no tracer is registered. */
export function traceStage<T>(
  name: string,
  input: unknown,
  run: () => Promise<T> | T,
  options: StageTrace<T> = {},
): Promise<T> {
  const traced = () =>
    startActiveObservation(name, async (span) => {
      if (span.otelSpan.isRecording()) options.onTraceId?.(span.traceId);
      span.update({ input });
      try {
        const result = await run();
        const level = options.level?.(result);
        span.update({ output: options.output?.(result), ...(level ? { level } : {}) });
        return result;
      } catch (error: unknown) {
        span.update({ level: "ERROR", statusMessage: errorMessage(error) });
        throw error;
      }
    });
  return options.attributes ? propagateAttributes(options.attributes, traced) : traced();
}
