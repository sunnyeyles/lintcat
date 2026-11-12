/** The conversational entry point: questions one at a time, then one spec for one approval. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { collectRun, type AgentRuntime, type AgentUsage } from "@pr-review/agent-runtime";
import { z } from "zod";

import { specSchema, type ProfileName, type Spec } from "#src/contract";
import { loadPrompt } from "#src/prompts";
import { runDir } from "#src/run-files";
import type { FactoryService, ProposalResult } from "#src/service";

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

const discoveryMessages = {
  outcome: (outcome: string) => `Desired outcome:\n\n${outcome}`,
  answer: (answer: string) => `Answer: ${answer}`,
  revise: (feedback: string) => `Revise the spec with this feedback, then propose it again:\n\n${feedback}`,
};

function parseTurn(structured: unknown): DiscoveryTurn {
  const turn = turnSchema.parse(structured);
  if (turn.kind === "question") {
    if (!turn.question) throw new Error("a question turn needs `question`");
    return { kind: "question", question: turn.question, facts: turn.facts ?? [], assumptions: turn.assumptions ?? [] };
  }
  if (!turn.spec) throw new Error("a proposal turn needs `spec`");
  return { kind: "proposal", spec: turn.spec };
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
      message = `Your last answer did not match the schema (${String(error)}). Answer again.`;
      continue;
    }

    if (turn.kind === "question" && questions >= maxQuestions) {
      message = "No more questions: propose the spec now, recording every open point as an assumption.";
      continue;
    }
    if (turn.kind === "question") questions++;
    return { turn, state: { ...(sessionId ? { sessionId } : {}), questions }, promptVersion: prompt.version, usage };
  }
}

export async function runDiscovery(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const { io } = options;
  const maxRevisions = options.maxRevisions ?? 3;
  const usage: AgentUsage[] = [];
  let state: DiscoveryState = { questions: 0 };
  let revisions = 0;
  let message = discoveryMessages.outcome(options.outcome);

  for (;;) {
    const step = await discoveryStep({
      runtime: options.runtime,
      repoPath: options.repoPath,
      message,
      state,
      ...(options.maxQuestions === undefined ? {} : { maxQuestions: options.maxQuestions }),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(io.progress ? { progress: (text: string) => io.progress?.(text) } : {}),
    });
    usage.push(...step.usage);
    state = step.state;
    const { turn } = step;

    if (turn.kind === "question") {
      message = discoveryMessages.answer(await io.ask(turn));
      continue;
    }

    const decision = await io.review(turn.spec);
    if (decision.decision === "approve") {
      return { status: "approved", spec: turn.spec, promptVersion: step.promptVersion, usage };
    }
    if (decision.decision === "abort" || ++revisions > maxRevisions) return { status: "aborted", usage };
    message = discoveryMessages.revise(decision.feedback);
  }
}

/** Discovery spread over separate calls (MCP), kept in `.factory/runs/<id>/discovery.json`. */
export interface DiscoverySession extends DiscoveryState {
  runId: string;
  repoPath: string;
  outcome: string;
  revisions: number;
  pending: "outcome" | "question" | "proposal";
  question?: Extract<DiscoveryTurn, { kind: "question" }>;
  profileOverride?: ProfileName;
  allowPullRequest?: boolean;
}

const sessionFile = (repoPath: string, runId: string) => join(runDir(repoPath, runId), "discovery.json");

async function saveDiscoverySession(session: DiscoverySession): Promise<void> {
  await mkdir(runDir(session.repoPath, session.runId), { recursive: true });
  await writeFile(sessionFile(session.repoPath, session.runId), `${JSON.stringify(session, null, 2)}\n`);
}

export async function loadDiscoverySession(repoPath: string, runId: string): Promise<DiscoverySession | null> {
  try {
    return JSON.parse(await readFile(sessionFile(repoPath, runId), "utf8")) as DiscoverySession;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export type DiscoveryReply =
  | { kind: "question"; runId: string; question: Extract<DiscoveryTurn, { kind: "question" }>; questionsAsked: number }
  | ({ kind: "proposal"; runId: string; spec: Spec } & ProposalResult);

export interface TurnOptions {
  service: Pick<FactoryService, "draft" | "propose" | "get">;
  runtime: AgentRuntime;
  maxQuestions?: number;
  maxRevisions?: number;
  signal?: AbortSignal;
}

async function advance(options: TurnOptions, session: DiscoverySession, message: string): Promise<DiscoveryReply> {
  const step = await discoveryStep({
    runtime: options.runtime,
    repoPath: session.repoPath,
    message,
    state: session,
    ...(options.maxQuestions === undefined ? {} : { maxQuestions: options.maxQuestions }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const next: DiscoverySession = { ...session, ...step.state };
  if (step.turn.kind === "question") {
    await saveDiscoverySession({ ...next, pending: "question", question: step.turn });
    return { kind: "question", runId: session.runId, question: step.turn, questionsAsked: next.questions };
  }
  const proposal = await options.service.propose({
    repoPath: session.repoPath,
    spec: step.turn.spec,
    promptVersion: step.promptVersion,
    runId: session.runId,
    ...(session.profileOverride ? { profileOverride: session.profileOverride } : {}),
    ...(session.allowPullRequest ? { allowPullRequest: true } : {}),
  });
  const { question: _answered, ...rest } = next;
  await saveDiscoverySession({ ...rest, pending: "proposal" });
  return { kind: "proposal", runId: session.runId, spec: step.turn.spec, ...proposal };
}

/** Records a draft run and runs the first discovery turn. */
export async function startDiscovery(
  options: TurnOptions & { repoPath: string; outcome: string; profileOverride?: ProfileName; allowPullRequest?: boolean },
): Promise<DiscoveryReply> {
  const run = await options.service.draft({ repoPath: options.repoPath, outcome: options.outcome });
  const session: DiscoverySession = {
    runId: run.id,
    repoPath: run.repoPath,
    outcome: options.outcome,
    questions: 0,
    revisions: 0,
    pending: "outcome",
    ...(options.profileOverride ? { profileOverride: options.profileOverride } : {}),
    ...(options.allowPullRequest ? { allowPullRequest: true } : {}),
  };
  await saveDiscoverySession(session);
  try {
    return await advance(options, session, discoveryMessages.outcome(options.outcome));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason} (run ${run.id} is kept as a draft: retry with factory_answer, or cancel it)`, { cause: error });
  }
}

/** Answers the pending question, or revises the pending proposal with feedback. */
export async function continueDiscovery(options: TurnOptions & { runId: string; answer: string }): Promise<DiscoveryReply> {
  const run = await options.service.get(options.runId);
  if (!run) throw new Error(`no run ${options.runId}`);
  if (run.status !== "draft" && run.status !== "awaiting_approval") {
    throw new Error(`run ${run.id} is ${run.status}; its discovery is over`);
  }
  const session = await loadDiscoverySession(run.repoPath, run.id);
  if (!session) throw new Error(`run ${run.id} was not started by discovery; propose a revised spec with factory_start instead`);
  const answer = options.answer.trim() || "(no answer: use your best judgement and record it as an assumption)";
  if (session.pending === "outcome") {
    return advance(options, session, `${discoveryMessages.outcome(session.outcome)}\n\nMore context: ${answer}`);
  }
  if (session.pending === "question") return advance(options, session, discoveryMessages.answer(answer));
  const maxRevisions = options.maxRevisions ?? 3;
  if (session.revisions >= maxRevisions) throw new Error(`run ${run.id} hit its ${maxRevisions}-revision limit: approve or cancel it`);
  return advance(options, { ...session, revisions: session.revisions + 1 }, discoveryMessages.revise(answer));
}
