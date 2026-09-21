import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import { generateText, isStepCount, tool, type TelemetryOptions } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createTelemetryIntegration } from "#src/langfuse";

const SECRETS = {
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
async function traceOneCall(
  recordIo: boolean,
  telemetry: Partial<TelemetryOptions> = {},
): Promise<ReadableSpan[]> {
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
            input: JSON.stringify({ path: SECRETS.toolArgs }),
          },
        ],
        "tool-calls",
      ),
      turn([{ type: "text", text: SECRETS.completion }], "stop"),
    ] as unknown as MockLanguageModelV4["doGenerate"],
  });

  await generateText({
    model,
    instructions: SECRETS.system,
    messages: [{ role: "user", content: SECRETS.diff }],
    tools: {
      get_file: tool({
        inputSchema: z.object({ path: z.string() }),
        execute: async () => SECRETS.fileContents,
      }),
    },
    stopWhen: isStepCount(3),
    telemetry: {
      ...telemetry,
      functionId: "review-agent-security",
      integrations: [
        createTelemetryIntegration({
          recordIo,
          tracer: provider.getTracer("test"),
        }),
      ],
    },
  });

  await provider.forceFlush();
  return exporter.getFinishedSpans();
}

function exportedText(spans: ReadableSpan[]): string {
  return JSON.stringify(spans.map((span) => [span.name, span.attributes]));
}

describe("createTelemetryIntegration", () => {
  it("exports no prompt, tool or completion payloads by default", async () => {
    const text = exportedText(await traceOneCall(false));

    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
    }
  });

  it("keeps suppressing when a call asks to record payloads", async () => {
    const text = exportedText(
      await traceOneCall(false, { recordInputs: true, recordOutputs: true }),
    );

    for (const secret of Object.values(SECRETS)) {
      expect(text).not.toContain(secret);
    }
  });

  it("still exports timings, token counts, tool names and the agent", async () => {
    const spans = await traceOneCall(false);
    const text = exportedText(spans);

    expect(spans.length).toBeGreaterThan(2);
    expect(spans.every((span) => span.duration[0] >= 0)).toBe(true);
    expect(text).toContain("review-agent-security");
    expect(text).toContain("get_file");
    expect(text).toContain("gen_ai.usage.input_tokens");
    expect(text).toContain("gen_ai.usage.output_tokens");
  });

  it("exports every payload when recordIo is opted into", async () => {
    const text = exportedText(await traceOneCall(true));

    for (const secret of Object.values(SECRETS)) {
      expect(text).toContain(secret);
    }
  });
});
