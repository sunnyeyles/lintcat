/** The conversational entry point: questions one at a time, then one spec for one approval. */
import { collectRun, type AgentRuntime, type AgentUsage } from "#src/agent/runtime";
import { z } from "zod";

import { specSchema, type Spec } from "#src/engine/contract";
import { loadPrompt, renderMessage } from "#src/engine/prompts";
import {
  matchResolutions,
  needsResolution,
  resolvableList,
  resolutionSchema,
  reviewSpec,
  type Resolution,
  type SpecAudit,
  type SpecReview,
} from "#src/engine/spec-review";

// Flat rather than a union: structured output schemas handle one object shape most reliably.
const turnSchema = z.object({
  kind: z.enum(["question", "proposal"]),
  question: z.string().optional(),
  facts: z.array(z.string()).optional(),
  assumptions: z.array(z.string()).optional(),
  spec: specSchema.optional(),
  resolutions: z.array(resolutionSchema).optional(),
});

type DiscoveryTurn =
  | { kind: "question"; question: string; facts: string[]; assumptions: string[] }
  | { kind: "proposal"; spec: Spec; resolutions: Resolution[] };

export type ReviewDecision = { decision: "approve" } | { decision: "revise"; feedback: string } | { decision: "abort" };

export interface DiscoveryIO {
  ask(turn: Extract<DiscoveryTurn, { kind: "question" }>): Promise<string>;
  /** `audit` is present on the first proposal only, unless review is turned off. */
  review(spec: Spec, promptVersion: string, audit?: SpecAudit): Promise<ReviewDecision>;
  progress?(message: string): void;
}

export interface DiscoveryOptions {
  runtime: AgentRuntime;
  repoPath: string;
  outcome: string;
  io: DiscoveryIO;
  maxQuestions?: number;
  maxRevisions?: number;
  /** A fresh reviewer audits the first proposal before the person sees it (scope only when routed `quick`); default on. */
  specReview?: boolean;
  signal?: AbortSignal;
}

export type DiscoveryResult =
  | { status: "approved"; spec: Spec; promptVersion: string; usage: AgentUsage[] }
  | { status: "aborted"; usage: AgentUsage[] };

/** What carries one discovery agent session from one turn to the next. */
interface DiscoveryState {
  sessionId?: string;
  questions: number;
}

interface DiscoveryStepOptions {
  runtime: AgentRuntime;
  repoPath: string;
  message: string;
  state: DiscoveryState;
  maxQuestions?: number;
  signal?: AbortSignal;
  progress?: (message: string) => void;
}

interface DiscoveryStep {
  turn: DiscoveryTurn;
  state: DiscoveryState;
  promptVersion: string;
  usage: AgentUsage[];
}

function parseTurn(structured: unknown): DiscoveryTurn {
  const turn = turnSchema.parse(structured);
  if (turn.kind === "question") {
    if (!turn.question) throw new Error("a question turn needs `question`");
    return { kind: "question", question: turn.question, facts: turn.facts ?? [], assumptions: turn.assumptions ?? [] };
  }
  if (!turn.spec) throw new Error("a proposal turn needs `spec`");
  return { kind: "proposal", spec: turn.spec, resolutions: turn.resolutions ?? [] };
}

/** One user-visible turn: a permitted question or a proposal, repairing schema misses and the question cap internally. */
async function discoveryStep(options: DiscoveryStepOptions): Promise<DiscoveryStep> {
  const { runtime, repoPath } = options;
  const maxQuestions = options.maxQuestions ?? 6;
  const prompt = loadPrompt("discovery");
  const outputSchema = z.toJSONSchema(turnSchema) as Record<string, unknown>;
  const usage: AgentUsage[] = [];
  let { sessionId, questions } = options.state;
  let message = options.message;
  let repairs = 0;

  for (;;) {
    options.progress?.("thinking…");
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
        if (event.type === "tool_call") options.progress?.(`${event.name}`);
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
      message = renderMessage("discovery", "schema-retry", { error: String(error) });
      continue;
    }

    if (turn.kind === "question" && questions >= maxQuestions) {
      message = renderMessage("discovery", "no-more-questions");
      continue;
    }
    if (turn.kind === "question") questions++;

    const state: DiscoveryState = { ...(sessionId ? { sessionId } : {}), questions };
    return { turn, state, promptVersion: prompt.version, usage };
  }
}

export async function runDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { io } = options;
  const maxRevisions = options.maxRevisions ?? 3;
  const usage: AgentUsage[] = [];
  let state: DiscoveryState = { questions: 0 };
  let revisions = 0;
  let message = renderMessage("discovery", "outcome", { outcome: options.outcome });

  const step = async (text: string) => {
    const result = await discoveryStep({
      runtime: options.runtime,
      repoPath: options.repoPath,
      message: text,
      state,
      ...(options.maxQuestions === undefined ? {} : { maxQuestions: options.maxQuestions }),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(io.progress ? { progress: (progress: string) => io.progress?.(progress) } : {}),
    });
    usage.push(...result.usage);
    state = result.state;
    return result;
  };

  const audit = async (spec: Spec): Promise<SpecReview | null> => {
    io.progress?.("fresh review of the spec…");
    try {
      const result = await reviewSpec({ runtime: options.runtime, repoPath: options.repoPath, spec, ...(options.signal ? { signal: options.signal } : {}) });
      usage.push(result.usage);
      return result.review;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      return null;
    }
  };

  let reviewed = false;
  for (;;) {
    let current = await step(message);
    if (current.turn.kind === "question") {
      message = renderMessage("discovery", "answer", { answer: await io.ask(current.turn) });
      continue;
    }

    let spec = current.turn.spec;
    let specAudit: SpecAudit | undefined;
    if (options.specReview !== false && !reviewed) {
      reviewed = true;
      const review = await audit(spec);
      specAudit = { review, resolutions: [] };
      if (review && needsResolution(review)) {
        current = await step(renderMessage("discovery", "resolve", { findings: resolvableList(review), reading: review.paraphrase.proposes }));
        if (current.turn.kind === "question") {
          message = renderMessage("discovery", "answer", { answer: await io.ask(current.turn) });
          continue;
        }
        // Routing inputs are the person's call, so discovery's revision cannot change them.
        const { category, estimatedFiles, risk, touchesSecurityOrData } = spec;
        spec = { ...current.turn.spec, category, estimatedFiles, risk, touchesSecurityOrData };
        specAudit = { review, resolutions: matchResolutions(review, current.turn.resolutions) };
      }
    }

    const decision = await io.review(spec, current.promptVersion, specAudit);
    if (decision.decision === "approve") {
      return { status: "approved", spec, promptVersion: current.promptVersion, usage };
    }
    if (decision.decision === "abort" || ++revisions > maxRevisions) return { status: "aborted", usage };
    message = renderMessage("discovery", "revise", { feedback: decision.feedback });
  }
}
