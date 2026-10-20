import { setLangfuseTracerProvider } from "@langfuse/tracing";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { traceStage, traceStream, type StreamEnd } from "#src/trace-stage";

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
  it("rethrows a failure and records its message on an ERROR span", async () => {
    const exporter = recording();
    const failure = new TypeError("the diff is too large");

    await expect(
      traceStage("load", undefined, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes["langfuse.observation.level"]).toBe("ERROR");
    expect(span?.attributes["langfuse.observation.status_message"]).toBe("the diff is too large");
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

describe("traceStream", () => {
  it("keeps the span open after start returns, until the first end", async () => {
    const exporter = recording();

    let end: ((result: StreamEnd) => void) | undefined;
    const value = traceStream("answer-docs-question", "what is lintcat?", (finish) => {
      end = finish;
      return "streaming";
    });
    await provider!.forceFlush();
    expect(value).toBe("streaming");
    expect(exporter.getFinishedSpans()).toEqual([]);

    end!({ output: "a reviewer" });
    end!({ output: "ignored", level: "ERROR" });
    await provider!.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.name)).toEqual(["answer-docs-question"]);
    expect(spans[0]!.attributes["langfuse.observation.output"]).toBe("a reviewer");
    expect(spans[0]!.attributes["langfuse.observation.level"]).toBeUndefined();
  });
});
