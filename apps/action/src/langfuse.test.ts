import {
  createReviewAgent,
  createSynthesiser,
  type ReviewAgentDeps,
} from "@pr-review/ai";
import {
  context,
  finalFindingsJson,
  makeFinding,
  makeGithub,
  makeModel,
  message,
  repositoryAgent,
  textBlock,
  toolUseBlock,
} from "@pr-review/ai/agent-test-support";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const DIFF_MARKER = "DIFF-PAYLOAD-7f3a";
const FILE_MARKER = "FILE-PAYLOAD-91c2";
const COMPLETION_MARKER = "COMPLETION-PAYLOAD-4be0";

const exporter = new InMemorySpanExporter();

// Same integration createLangfuseRuntime registers, exporting in memory.
beforeAll(() => {
  new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  }).register();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
});

beforeEach(() => {
  exporter.reset();
});

async function reviewAndSynthesise(recordPayloads?: boolean) {
  const finding = makeFinding("security", { title: COMPLETION_MARKER });
  const { model } = makeModel([
    message(
      [toolUseBlock("toolu_1", "get_file", { path: "src/sessions.ts" })],
      "tool_use",
      { inputTokens: 11, outputTokens: 7 },
    ),
    message([textBlock(finalFindingsJson([finding]))], "end_turn"),
    message([textBlock(finalFindingsJson([finding]))], "end_turn"),
  ]);
  const github = makeGithub();
  github.getFileContents.mockResolvedValue(`export const x = "${FILE_MARKER}";\n`);
  const agent = repositoryAgent("security");
  const optIn = recordPayloads === undefined ? {} : { recordPayloads };
  const deps: ReviewAgentDeps = {
    model,
    github,
    logger: { info: () => {}, error: () => {} },
    ...optIn,
  };

  const findings = await createReviewAgent(agent, deps).run({
    ...context,
    diff: `${context.diff}+// ${DIFF_MARKER}\n`,
  });
  await createSynthesiser({ model, agents: [agent], ...optIn }).synthesise(
    findings,
  );

  const spans = exporter.getFinishedSpans();
  return {
    spans,
    exported: JSON.stringify(
      spans.map((span) => ({ name: span.name, attributes: span.attributes })),
    ),
  };
}

describe("Langfuse span payloads", () => {
  it("exports no prompts, tool results, file contents or completions by default", async () => {
    const { spans, exported } = await reviewAndSynthesise();

    expect(spans.length).toBeGreaterThan(0);
    expect(exported).not.toContain(DIFF_MARKER);
    expect(exported).not.toContain(FILE_MARKER);
    expect(exported).not.toContain(COMPLETION_MARKER);
    expect(exported).not.toContain("untrusted repository data");
  });

  it("still exports agent names, token counts and outcomes by default", async () => {
    const { spans, exported } = await reviewAndSynthesise();

    const names = spans.map((span) => span.name);
    expect(names).toContain("review-agent-security");
    expect(names).toContain("synthesise-findings");
    expect(exported).toContain("findingCount");
    expect(exported).toMatch(/input_tokens|inputTokens/);
  });

  it("exports the payloads when recordPayloads is set", async () => {
    const { exported } = await reviewAndSynthesise(true);

    expect(exported).toContain(DIFF_MARKER);
    expect(exported).toContain(FILE_MARKER);
    expect(exported).toContain(COMPLETION_MARKER);
  });
});
