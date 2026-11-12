/** The factory as MCP tools: a thin client of the factory service, like the CLI. */
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AgentRuntime } from "@pr-review/agent-runtime";
import {
  continueDiscovery,
  loadDiscoverySession,
  PROFILE_NAMES,
  renderTaskMarkdown,
  repoRoot,
  specSchema,
  startDiscovery,
  TOOL_VERSION,
  type DiscoveryReply,
  type FactoryRun,
  type FactoryService,
} from "@pr-review/factory";
import { z } from "zod";

import { formatEvent, renderResult, renderRuns, renderSpec, renderStatus } from "#src/render";

export type LaunchResult = { mode: "detached"; pid: number | undefined; log: string } | { mode: "worker" };

export interface FactoryMcpOptions {
  service: FactoryService;
  /** Runs discovery turns; execution happens in the launched process, never here. */
  runtime: AgentRuntime;
  cwd: string;
  /** Starts execution of an approved run outside this server's lifetime. */
  launch: (run: FactoryRun) => Promise<LaunchResult>;
  /** Throws when execution could not start, before anything is approved. */
  preflight?: () => Promise<void>;
}

const INSTRUCTIONS = `The software factory turns an approved spec into a verified git branch, unattended.
1. factory_start with an outcome runs discovery one turn per call: relay each question to the user and pass their reply to factory_answer, until a proposal comes back. Or factory_start with a complete spec you wrote.
2. Show the proposed spec to the user (factory_read_task). Only after the user explicitly approves it, call factory_approve. That is the single approval; the run then proceeds without questions.
3. Execution runs in a separate process that outlives this session. Poll factory_status; fetch factory_result when it is delivered, failed or cancelled.`;

const TERMINAL = new Set(["delivered", "failed", "cancelled"]);
const runIdSchema = z.string().min(1).describe("The run id factory_start returned.");

const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
const reply = (text: string, structured: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text }],
  structuredContent: plain(structured),
});
const failure = (text: string): CallToolResult => ({ isError: true, content: [{ type: "text", text }] });
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function runSummary(run: FactoryRun) {
  const { id, title, status, stage, profile, branch, repoPath, blocker, cancelRequested, createdAt, updatedAt, finishedAt } = run;
  return { id, title, status, stage, profile, branch, repoPath, blocker, cancelRequested, createdAt, updatedAt, finishedAt };
}

function discoveryText(result: DiscoveryReply): string {
  if (result.kind === "question") {
    const { question, facts, assumptions } = result.question;
    return [
      `Run ${result.runId}: discovery question ${result.questionsAsked}.`,
      ...(facts.length ? ["Found:", ...facts.map((f) => `  - ${f}`)] : []),
      ...(assumptions.length ? ["Assuming:", ...assumptions.map((a) => `  - ${a}`)] : []),
      `Question: ${question}`,
      `Ask the user, then call factory_answer with runId "${result.runId}" and their answer.`,
    ].join("\n");
  }
  return proposalText(result.runId, result.spec, result.route);
}

function proposalText(runId: string, spec: Parameters<typeof renderSpec>[0], route: Parameters<typeof renderSpec>[1]): string {
  const next = route.ok
    ? `Show this to the user. Only on their explicit approval, call factory_approve with runId "${runId}". To change it, call factory_answer with their feedback.`
    : "This spec cannot be approved as it stands; revise it with factory_answer, or cancel it.";
  return `${renderSpec(spec, route, runId)}\n\n${next}`;
}

async function knownRun(service: FactoryService, runId: string): Promise<FactoryRun> {
  const run = await service.get(runId);
  if (!run) throw new Error(`no run ${runId}`);
  return run;
}

/** Turns a thrown error into a tool error the host model can read and act on. */
function guarded<A>(handler: (args: A, extra: { signal: AbortSignal }) => Promise<CallToolResult>) {
  return async (args: A, extra: { signal: AbortSignal }): Promise<CallToolResult> => {
    try {
      return await handler(args, extra);
    } catch (error) {
      return failure(message(error));
    }
  };
}

export function createFactoryMcpServer(options: FactoryMcpOptions): McpServer {
  const { service, runtime } = options;
  const server = new McpServer({ name: "software-factory", version: TOOL_VERSION }, { instructions: INSTRUCTIONS });
  const turning = new Set<string>();

  async function oneTurn(runId: string | undefined, work: () => Promise<DiscoveryReply>): Promise<CallToolResult> {
    if (runId && turning.has(runId)) return failure(`a discovery turn for ${runId} is already running`);
    if (runId) turning.add(runId);
    try {
      const result = await work();
      return reply(discoveryText(result), plain(result));
    } finally {
      if (runId) turning.delete(runId);
    }
  }

  server.registerTool(
    "factory_start",
    {
      title: "Start a factory task",
      description:
        "Start a task in a local git repository. With `outcome`, runs one discovery turn (the agent reads the repo " +
        "read-only) and returns a question or a proposed spec; continue with factory_answer. With `spec`, records " +
        "your own complete spec as awaiting approval. Either way nothing runs until factory_approve. Returns the run id.",
      inputSchema: {
        repoPath: z.string().optional().describe("Path to the git checkout; defaults to the server's working directory."),
        outcome: z.string().min(1).optional().describe("The desired outcome in plain words, for discovery."),
        spec: specSchema.optional().describe("A complete spec, instead of discovery."),
        profile: z.enum(PROFILE_NAMES).optional().describe("Override the routed workflow profile."),
        pullRequest: z.boolean().optional().describe("Push and open a PR on delivery; defaults to a local branch only."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded(async ({ repoPath, outcome, spec, profile, pullRequest }, extra) => {
      if ((outcome === undefined) === (spec === undefined)) return failure("give exactly one of `outcome` or `spec`");
      const repo = await repoRoot(path.resolve(options.cwd, repoPath ?? ".")).catch(() => {
        throw new Error(`${repoPath ?? options.cwd} is not inside a git repository`);
      });
      const choices = { ...(profile ? { profileOverride: profile } : {}), ...(pullRequest ? { allowPullRequest: true } : {}) };
      if (spec) {
        const { run, route } = await service.propose({ repoPath: repo, spec, promptVersion: "host-authored", ...choices });
        return reply(proposalText(run.id, spec, route), { kind: "proposal", runId: run.id, spec, route, run: runSummary(run) });
      }
      return oneTurn(undefined, () =>
        startDiscovery({ service, runtime, repoPath: repo, outcome: outcome!, signal: extra.signal, ...choices }),
      );
    }),
  );

  server.registerTool(
    "factory_answer",
    {
      title: "Answer a discovery question",
      description:
        "Continue discovery for a run: answers its pending question, or, once a spec is proposed, revises the " +
        "spec with this feedback. Runs one discovery turn and returns the next question or proposal.",
      inputSchema: {
        runId: runIdSchema,
        answer: z.string().describe("The user's answer or feedback, in their words."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    guarded(async ({ runId, answer }, extra) =>
      oneTurn(runId, () => continueDiscovery({ service, runtime, runId, answer, signal: extra.signal })),
    ),
  );

  server.registerTool(
    "factory_status",
    {
      title: "Factory run status",
      description: "One run's status, stage, blocker and recent events; or, without a runId, the recent runs.",
      inputSchema: {
        runId: runIdSchema.optional(),
        repoPath: z.string().optional().describe("Without a runId, list only this repository's runs."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ runId, repoPath }) => {
      if (!runId) {
        const repo = repoPath ? await repoRoot(path.resolve(options.cwd, repoPath)) : undefined;
        const runs = await service.list({ limit: 20, ...(repo ? { repoPath: repo } : {}) });
        return reply(renderRuns(runs), { runs: runs.map(runSummary) });
      }
      const run = await knownRun(service, runId);
      const events = await service.events(runId);
      const recent = events.slice(-10);
      const session = run.status === "draft" || run.status === "awaiting_approval" ? await loadDiscoverySession(run.repoPath, run.id) : null;
      const pending = session?.pending === "question" ? session.question : undefined;
      const lines = [renderStatus(run), ...(pending ? [`Pending question: ${pending.question}`] : [])];
      if (recent.length) lines.push("", ...recent.map(formatEvent));
      return reply(lines.join("\n"), {
        run: runSummary(run),
        terminal: TERMINAL.has(run.status),
        ...(pending ? { pendingQuestion: pending } : {}),
        events: recent.map(({ at, kind, stage, data }) => ({ at, kind, stage, data })),
      });
    }),
  );

  server.registerTool(
    "factory_read_task",
    {
      title: "Read a run's task.md",
      description:
        "The run's Markdown source of truth (.factory/runs/<id>/task.md): spec, plan, progress, verification. " +
        "Before execution starts it is rendered from the proposed spec.",
      inputSchema: { runId: runIdSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ runId }) => {
      const run = await knownRun(service, runId);
      if (run.status === "draft") return failure(`${runId} has no spec yet: discovery is still in progress`);
      const taskPath = path.join(run.repoPath, ".factory", "runs", run.id, "task.md");
      const stored = await service.readTask(run);
      const markdown =
        stored ??
        renderTaskMarkdown({
          runId: run.id,
          status: run.status,
          stage: run.stage,
          profile: run.profile,
          contract: run.contract,
          progress: [],
          verification: [],
          deviations: [],
          blockers: run.blocker ? [run.blocker] : [],
          outcome: null,
        });
      return reply(markdown, { runId, path: taskPath, written: stored !== null, markdown });
    }),
  );

  server.registerTool(
    "factory_approve",
    {
      title: "Approve a factory spec",
      description:
        "The single approval: freezes the proposed spec and starts execution in a separate process that survives " +
        "this session. Returns at once. Call only after the user has seen the spec and explicitly approved it.",
      inputSchema: { runId: runIdSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    guarded(async ({ runId }) => {
      const run = await knownRun(service, runId);
      if (run.status === "draft") return failure(`${runId} has no spec yet: answer its discovery question first`);
      if (run.status !== "awaiting_approval") return failure(`${runId} is ${run.status}, not awaiting approval`);
      await options.preflight?.();
      const approved = await service.approve(runId);
      let launched: LaunchResult;
      try {
        launched = await options.launch(approved);
      } catch (error) {
        return failure(`${runId} is approved and queued, but could not be started (${message(error)}); run \`factory run ${runId}\` or a \`factory worker\``);
      }
      const how =
        launched.mode === "detached"
          ? `Running in a background process (pid ${launched.pid ?? "?"}, log ${launched.log}).`
          : "Queued for a running `factory worker`.";
      return reply(`Approved ${runId}. ${how} Poll factory_status; fetch factory_result when it finishes.`, {
        run: runSummary(approved),
        launch: launched,
      });
    }),
  );

  server.registerTool(
    "factory_cancel",
    {
      title: "Cancel a factory run",
      description: "Cancel a run, or discard a discovery. A running run stops at its next safe point; its branch and worktree stay.",
      inputSchema: { runId: runIdSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    guarded(async ({ runId }) => {
      const outcome = await service.cancel(runId);
      if (outcome === "missing") return failure(`no run ${runId}`);
      const text = {
        cancelled: `${runId} cancelled`,
        requested: `cancel requested; ${runId} stops at its next safe point`,
        finished: `${runId} already finished`,
      }[outcome];
      return reply(text, { runId, outcome });
    }),
  );

  server.registerTool(
    "factory_result",
    {
      title: "Factory run result",
      description:
        "Branch or PR, check results, implementation decisions, failed commands and usage for a run. " +
        "Complete once factory_status reports it terminal.",
      inputSchema: { runId: runIdSchema },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ runId }) => {
      const run = await knownRun(service, runId);
      const taskPath = path.join(run.repoPath, ".factory", "runs", run.id, "task.md");
      const commands = (await service.commands(runId)).map(({ stage, name, command, exitCode, timedOut, durationMs }) => ({
        stage,
        name,
        command,
        exitCode,
        timedOut,
        durationMs,
      }));
      const decisions = run.contract.implementationDecisions;
      const durationMs = run.finishedAt ? run.finishedAt.getTime() - run.createdAt.getTime() : null;
      const failed = commands.filter((c) => c.exitCode !== 0 || c.timedOut);
      const text = [
        renderResult(run, taskPath),
        ...(decisions.length ? ["Decisions:", ...decisions.map((d) => `  - [${d.stage}] ${d.decision}`)] : []),
        ...(failed.length ? ["Failed commands:", ...failed.map((c) => `  - ${c.stage}/${c.name} exit ${c.exitCode}: ${c.command}`)] : []),
        ...(TERMINAL.has(run.status) ? [] : [`Not finished yet (${run.status}).`]),
      ].join("\n");
      return reply(text, {
        run: runSummary(run),
        terminal: TERMINAL.has(run.status),
        outcome: run.outcome ?? null,
        decisions,
        commands,
        metrics: { durationMs, attempts: run.attempts, recoveries: run.recoveries, usage: run.outcome?.usage ?? null },
        taskPath,
      });
    }),
  );

  return server;
}
