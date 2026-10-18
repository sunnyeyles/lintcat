import { setLangfuseTracerProvider } from "@langfuse/tracing";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { traceStage } from "#src/trace-stage";

const SECRET = "ghs_SECRET-SENTINEL";

let provider: NodeTracerProvider | undefined;
afterEach(async () => {
  setLangfuseTracerProvider(null);
  await provider?.shutdown();
  provider = undefined;
});

function recording(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  setLangfuseTracerProvider(provider);
  return exporter;
}

describe("traceStage", () => {
  it("rethrows a failure but exports only the error's name, never its message", async () => {
    const exporter = recording();
    const failure = new TypeError(`token ${SECRET} rejected`);

    await expect(
      traceStage("load", undefined, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes["langfuse.observation.level"]).toBe("ERROR");
    expect(span?.attributes["langfuse.observation.status_message"]).toBe("TypeError");
    expect(JSON.stringify(span?.attributes) + JSON.stringify(span?.status)).not.toContain(SECRET);
  });

  it("marks a result that returned but went wrong with its level", async () => {
    const exporter = recording();

    await traceStage("review-job", undefined, () => "retrying", {
      output: (outcome) => ({ outcome }),
      level: (outcome) => (outcome === "retrying" ? "WARNING" : undefined),
    });

    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes["langfuse.observation.level"]).toBe("WARNING");
    expect(span?.attributes["langfuse.observation.output"]).toBe(JSON.stringify({ outcome: "retrying" }));
  });

  it("reports the trace id only while a tracer is recording", async () => {
    const unrecorded = vi.fn();
    await traceStage("review-job", undefined, () => 1, { onTraceId: unrecorded });
    expect(unrecorded).not.toHaveBeenCalled();

    const exporter = recording();
    const recorded = vi.fn();
    await traceStage("review-job", undefined, () => 1, { onTraceId: recorded });
    expect(recorded).toHaveBeenCalledWith(exporter.getFinishedSpans()[0]?.spanContext().traceId);
  });
});
