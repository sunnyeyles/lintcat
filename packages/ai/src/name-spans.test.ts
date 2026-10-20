import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, describe, expect, it } from "vitest";

import { namingProcessor, stableSpanName } from "#src/name-spans";

describe("stableSpanName", () => {
  it.each([
    ["chat claude-sonnet-5", undefined, "chat"],
    ["embeddings text-embedding-3-small", undefined, "embeddings"],
    ["invoke_agent claude-sonnet-5", "find-issues", "find-issues"],
    ["invoke_agent claude-sonnet-5", undefined, "invoke_agent"],
    ["step 12", undefined, "step"],
    ["execute_tool get_file", undefined, "execute_tool get_file"],
    ["validate-findings", undefined, "validate-findings"],
  ])("names %s (agent %s) as %s", (name, agent, expected) => {
    expect(stableSpanName(name, agent)).toBe(expected);
  });
});

let provider: NodeTracerProvider | undefined;
afterEach(async () => {
  await provider?.shutdown();
  provider = undefined;
});

describe("namingProcessor", () => {
  it("renames model-suffixed spans and tags only the root with its source", async () => {
    const exporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [namingProcessor(new SimpleSpanProcessor(exporter), "worker")],
    });
    // Registers the context manager, so the child sees its active parent.
    provider.register();
    const tracer = provider.getTracer("test");

    tracer.startActiveSpan("run-review-job", (root) => {
      tracer.startSpan("chat claude-sonnet-5").end();
      root.end();
    });
    await provider.forceFlush();

    const spans = Object.fromEntries(exporter.getFinishedSpans().map((span) => [span.name, span.attributes]));
    expect(Object.keys(spans).sort()).toEqual(["chat", "run-review-job"]);
    expect(spans["run-review-job"]!["langfuse.trace.tags"]).toEqual(["worker"]);
    expect(spans.chat!["langfuse.trace.tags"]).toBeUndefined();
  });
});
