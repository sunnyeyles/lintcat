/** The factory's one API: the CLI now and the MCP server later are thin clients of it. */
import { randomBytes } from "node:crypto";

import type { AgentRuntime } from "@pr-review/agent-runtime";
import type { StructuredLogger } from "@pr-review/logging";

import { contractHash, freezeContract, type ProfileName, type Spec, type TaskContract } from "#src/contract";
import { executeRun, type EngineDeps } from "#src/engine";
import { currentBranch, ensureFactoryExcluded, headSha, repoRoot } from "#src/git";
import { loadProfile, loadProfiles, workflowVersion } from "#src/profiles";
import { readTaskMarkdown } from "#src/run-files";
import { routeTask, type Route } from "#src/router";
import type { SandboxProvider } from "#src/sandbox/index";
import {
  appendEvent,
  approveRun,
  claimRun,
  createRun,
  getRun,
  listCommands,
  listEvents,
  listRuns,
  profileSummary,
  requestCancel,
  updateDraft,
  type FactoryDatabase,
  type FactoryRun,
} from "#src/store/index";

export interface FactoryServiceOptions {
  database: FactoryDatabase;
  runtime: AgentRuntime;
  sandboxes: SandboxProvider;
  logger: StructuredLogger;
  delivery?: "branch" | "pr";
  openPullRequest?: EngineDeps["openPullRequest"];
  leaseMs?: number;
  heartbeatMs?: number;
  sandboxImage?: string;
}

export interface ProposalInput {
  repoPath: string;
  spec: Spec;
  promptVersion: string;
  profileOverride?: ProfileName;
  allowPullRequest?: boolean;
  /** Updates this awaiting-approval run instead of creating one. */
  runId?: string;
}

export type ProposalResult = { run: FactoryRun; route: Route };

const newRunId = () => `r${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;

export function createFactoryService(options: FactoryServiceOptions) {
  const { database } = options;
  const engineDeps: EngineDeps = {
    database,
    runtime: options.runtime,
    sandboxes: options.sandboxes,
    logger: options.logger,
    delivery: options.delivery ?? "branch",
    ...(options.openPullRequest ? { openPullRequest: options.openPullRequest } : {}),
    ...(options.leaseMs ? { leaseMs: options.leaseMs } : {}),
    ...(options.heartbeatMs ? { heartbeatMs: options.heartbeatMs } : {}),
    ...(options.sandboxImage ? { sandboxImage: options.sandboxImage } : {}),
  };

  return {
    /** Records a proposed spec as awaiting approval; routing decides the profile. */
    async propose(input: ProposalInput): Promise<ProposalResult> {
      const repo = await repoRoot(input.repoPath);
      await ensureFactoryExcluded(repo);
      const route = routeTask(input.spec, loadProfiles(), input.profileOverride);
      const profileName = route.ok ? route.profile : (input.profileOverride ?? "quick");
      const profile = loadProfile(profileName);
      const id = input.runId ?? newRunId();
      const contract: TaskContract = {
        contractVersion: 1,
        taskId: id,
        repoPath: repo,
        baseSha: await headSha(repo),
        baseBranch: await currentBranch(repo),
        profile: profileName,
        routing: route.ok ? { reason: route.reason, overridden: route.overridden } : { reason: route.blocker, overridden: false },
        spec: input.spec,
        permittedOperations: {
          push: input.allowPullRequest === true,
          openPullRequest: input.allowPullRequest === true,
          networkDuringSetup: true,
        },
        budgets: profile.budgets,
        approval: { state: "pending" },
        implementationDecisions: [],
      };
      const fields = { contract, title: input.spec.title, status: "awaiting_approval" as const, profile: profileName };
      const run = input.runId
        ? await updateDraft(database, input.runId, fields)
        : await createRun(database, { id, repoPath: repo, title: input.spec.title, contract, status: "awaiting_approval" });
      if (!run) throw new Error(`run ${input.runId} is no longer awaiting approval`);
      await appendEvent(database, { runId: id, kind: "spec_proposed", promptVersion: input.promptVersion, data: { profile: profileName, route } });
      return { run, route };
    },

    /** The single approval gate: freezes the contract and queues the run. */
    async approve(runId: string): Promise<FactoryRun> {
      const run = await getRun(database, runId);
      if (!run) throw new Error(`no run ${runId}`);
      const route = routeTask(run.contract.spec, loadProfiles(), run.contract.profile);
      if (!route.ok) throw new Error(`cannot approve: ${route.blocker}`);
      const frozen = freezeContract(run.contract, new Date());
      const ok = await approveRun(database, runId, frozen, {
        profile: frozen.profile,
        workflowVersion: workflowVersion(loadProfile(frozen.profile)),
        contractHash: contractHash(frozen),
        baseSha: frozen.baseSha,
      });
      if (!ok) throw new Error(`run ${runId} is not awaiting approval`);
      await appendEvent(database, { runId, kind: "approved", data: { hash: frozen.approval.hash } });
      return (await getRun(database, runId))!;
    },

    /** Claims one run (a named one, or the next due) and drives it to a terminal state. */
    async runNext(filter: { runId?: string } = {}) {
      const claimed = await claimRun(database, { leaseMs: options.leaseMs ?? 60_000, ...filter });
      if (!claimed) return null;
      const status = await executeRun(engineDeps, claimed);
      return { runId: claimed.id, status };
    },

    async worker({ signal, pollMs = 2_000, onRun }: { signal: AbortSignal; pollMs?: number; onRun?: (r: { runId: string; status: string }) => void }) {
      while (!signal.aborted) {
        const done = await this.runNext();
        if (done) onRun?.(done);
        else await new Promise((resolve) => setTimeout(resolve, pollMs).unref());
      }
    },

    cancel: (runId: string) => requestCancel(database, runId),
    get: (runId: string) => getRun(database, runId),
    list: (filter: { limit?: number; repoPath?: string } = {}) => listRuns(database, { limit: filter.limit ?? 20, ...(filter.repoPath ? { repoPath: filter.repoPath } : {}) }),
    events: (runId: string, afterId?: number) => listEvents(database, runId, afterId === undefined ? {} : { afterId }),
    commands: (runId: string) => listCommands(database, runId),
    summary: () => profileSummary(database),
    readTask: (run: FactoryRun) => readTaskMarkdown(run.repoPath, run.id),
  };
}

export type FactoryService = ReturnType<typeof createFactoryService>;
