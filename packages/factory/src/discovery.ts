/** The conversational entry point: questions one at a time, then one spec for one approval. */
import { collectRun, type AgentRuntime, type AgentUsage } from "@pr-review/agent-runtime";
import { z } from "zod";

import { specSchema, type Spec } from "#src/contract";
import { loadPrompt } from "#src/prompts";

// Flat rather than a union: structured output schemas handle one object shape most reliably.
const turnSchema = z.object({
  kind: z.enum(["question", "proposal"]),
  question: z.string().optional(),
  facts: z.array(z.string()).optional(),
  assumptions: z.array(z.string()).optional(),
  spec: specSchema.optional(),
});

export type DiscoveryTurn =
  | { kind: "question"; question: string; facts: string[]; assumptions: string[] }
  | { kind: "proposal"; spec: Spec };

export type ReviewDecision = { decision: "approve" } | { decision: "revise"; feedback: string } | { decision: "abort" };

export interface DiscoveryIO {
  ask(turn: Extract<DiscoveryTurn, { kind: "question" }>): Promise<string>;
  review(spec: Spec): Promise<ReviewDecision>;
  progress?(message: string): void;
}

export interface DiscoveryOptions {
  runtime: AgentRuntime;
  repoPath: string;
  outcome: string;
  io: DiscoveryIO;
  maxQuestions?: number;
  maxRevisions?: number;
  signal?: AbortSignal;
}

export type DiscoveryResult =
  | { status: "approved"; spec: Spec; promptVersion: string; usage: AgentUsage[] }
  | { status: "aborted"; usage: AgentUsage[] };

function parseTurn(structured: unknown): DiscoveryTurn {
  const turn = turnSchema.parse(structured);
  if (turn.kind === "question") {
    if (!turn.question) throw new Error("a question turn needs `question`");
    return { kind: "question", question: turn.question, facts: turn.facts ?? [], assumptions: turn.assumptions ?? [] };
  }
  if (!turn.spec) throw new Error("a proposal turn needs `spec`");
  return { kind: "proposal", spec: turn.spec };
}

export async function runDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { runtime, repoPath, io } = options;
  const maxQuestions = options.maxQuestions ?? 6;
  const maxRevisions = options.maxRevisions ?? 3;
  const prompt = loadPrompt("discovery");
  const outputSchema = z.toJSONSchema(turnSchema) as Record<string, unknown>;
  const usage: AgentUsage[] = [];
  let sessionId: string | undefined;
  let questions = 0;
  let revisions = 0;
  let message = `Desired outcome:\n\n${options.outcome}`;
  let repairs = 0;

  for (;;) {
    io.progress?.("thinking…");
    const result = await collectRun(
      runtime.run({
        role: "discovery",
        promptVersion: prompt.version,
        systemPrompt: prompt.text,
        prompt: message,
        cwd: repoPath,
        readOnly: true,
        maxTurns: 40,
        outputSchema,
        ...(sessionId ? { resumeSessionId: sessionId } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      }),
      (event) => {
        if (event.type === "session") sessionId = event.sessionId;
        if (event.type === "tool_call") io.progress?.(`${event.name}`);
      },
    );
    usage.push(result.usage);
    if (!result.ok) throw new Error(`discovery agent failed: ${result.reason}`);

    let turn: DiscoveryTurn;
    try {
      turn = parseTurn(result.structured);
      repairs = 0;
    } catch (error) {
      if (++repairs > 2) throw error;
      message = `Your last answer did not match the schema (${String(error)}). Answer again.`;
      continue;
    }

    if (turn.kind === "question") {
      if (questions >= maxQuestions) {
        message = "No more questions: propose the spec now, recording every open point as an assumption.";
        continue;
      }
      questions++;
      message = `Answer: ${await io.ask(turn)}`;
      continue;
    }

    const decision = await io.review(turn.spec);
    if (decision.decision === "approve") {
      return { status: "approved", spec: turn.spec, promptVersion: prompt.version, usage };
    }
    if (decision.decision === "abort" || ++revisions > maxRevisions) return { status: "aborted", usage };
    message = `Revise the spec with this feedback, then propose it again:\n\n${decision.feedback}`;
  }
}
