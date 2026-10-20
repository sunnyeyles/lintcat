import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import { createCapturingLogger } from "@pr-review/logging";
import { generateText, isStepCount, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createTelemetryIntegration, startTracing } from "#src/tracing";

const PAYLOADS = {
  system: "SYSTEM-PROMPT-SENTINEL",
  diff: "DIFF-SENTINEL",
  toolArgs: "TOOL-ARGS-SENTINEL",
  fileContents: "FILE-CONTENTS-SENTINEL",
  completion: "COMPLETION-SENTINEL",
};

function turn(content: unknown[], unified: "tool-calls" | "stop") {
  return {
    content,
    finishReason: { unified, raw: unified },
    usage: {
      inputTokens: { total: 11, noCache: 11, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 7, text: 7, reasoning: 0 },
    },
    warnings: [],
  };
}

const providers: NodeTracerProvider[] = [];
afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.shutdown()));
});

/** Runs one tool-using agent call through the integration and returns its spans. */
async function traceOneCall(): Promise<ReadableSpan[]> {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  providers.push(provider);

  const model = new MockLanguageModelV4({
    doGenerate: [
      turn(
        [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "get_file",
            input: JSON.stringify({ path: PAYLOADS.toolArgs }),
          },
        ],
        "tool-calls",
      ),
      turn([{ type: "text", text: PAYLOADS.completion }], "stop"),
    ] as unknown as MockLanguageModelV4["doGenerate"],
  });

  await generateText({
    model,
    instructions: PAYLOADS.system,
    messages: [{ role: "user", content: PAYLOADS.diff }],
    tools: {
      get_file: tool({
        inputSchema: z.object({ path: z.string() }),
        execute: async () => PAYLOADS.fileContents,
      }),
    },
    stopWhen: isStepCount(3),
    telemetry: {
      functionId: "review-agent-general",
      integrations: [createTelemetryIntegration(provider.getTracer("test"))],
    },
  });

  await provider.forceFlush();
  return exporter.getFinishedSpans();
}

describe("createTelemetryIntegration", () => {
  it("exports every prompt, tool argument, tool result and completion", async () => {
    const text = JSON.stringify((await traceOneCall()).map((span) => [span.name, span.attributes]));

    for (const payload of Object.values(PAYLOADS)) {
      expect(text).toContain(payload);
    }
  });

  it("exports timings, token counts, tool names and the agent", async () => {
    const spans = await traceOneCall();
    const text = JSON.stringify(spans.map((span) => [span.name, span.attributes]));

    expect(spans.length).toBeGreaterThan(2);
    expect(text).toContain("review-agent-general");
    expect(text).toContain("get_file");
    expect(text).toContain("gen_ai.usage.input_tokens");
  });
});

describe("startTracing", () => {
  it("stays off without keys", () => {
    const { logger, entries } = createCapturingLogger();

    expect(startTracing({}, logger, "cli")).toBeUndefined();
    expect(entries).toEqual([]);
  });

  it("stays off and says which key is missing when only one is set", () => {
    const { logger, entries } = createCapturingLogger();

    expect(startTracing({ LANGFUSE_PUBLIC_KEY: "pk-lf-1" }, logger, "cli")).toBeUndefined();
    expect(entries).toEqual([
      {
        level: "error",
        event: "tracing.disabled_incomplete_credentials",
        missing: "LANGFUSE_SECRET_KEY",
      },
    ]);
  });
});
