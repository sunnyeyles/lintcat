/** The versioned task contract: what the user approved, frozen by hash. */
import { createHash } from "node:crypto";

import { z } from "zod";

export const PROFILE_NAMES = ["quick", "bugfix", "feature", "refactor"] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

const acceptanceCriterionSchema = z.object({
  id: z.string().regex(/^AC\d+$/),
  text: z.string().min(1),
  verification: z.enum(["automated", "manual"]),
});

/** What discovery proposes and the user approves. */
export const specSchema = z.object({
  title: z.string().min(1).max(120),
  objective: z.string().min(1),
  category: z.enum(["quick", "bugfix", "feature", "refactor", "greenfield"]),
  requirements: z.array(z.string().min(1)).min(1),
  nonGoals: z.array(z.string()),
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1),
  plan: z.array(z.string().min(1)).min(1),
  architectureDecisions: z.array(z.string()),
  repositoryFindings: z.array(z.string()),
  assumptions: z.array(z.string()),
  estimatedFiles: z.number().int().min(0),
  risk: z.enum(["low", "medium", "high"]),
  touchesSecurityOrData: z.boolean(),
});
export type Spec = z.infer<typeof specSchema>;

export const budgetsSchema = z.object({
  maxAgentTurns: z.number().int().positive(),
  maxRepairPasses: z.number().int().min(0).max(3),
  wallClockMinutes: z.number().int().positive(),
  commandTimeoutSeconds: z.number().int().positive(),
});

const permittedOperationsSchema = z.object({
  push: z.boolean(),
  openPullRequest: z.boolean(),
  networkDuringSetup: z.boolean(),
});

const decisionSchema = z.object({ at: z.string(), stage: z.string(), decision: z.string().min(1) });

const taskContractSchema = z.object({
  contractVersion: z.literal(1),
  taskId: z.string().min(1),
  repoPath: z.string().min(1),
  baseSha: z.string().regex(/^[0-9a-f]{40}$/),
  baseBranch: z.string().nullable(),
  profile: z.enum(PROFILE_NAMES),
  routing: z.object({ reason: z.string(), overridden: z.boolean() }),
  spec: specSchema,
  permittedOperations: permittedOperationsSchema,
  budgets: budgetsSchema,
  approval: z.object({
    state: z.enum(["pending", "approved"]),
    approvedAt: z.string().optional(),
    hash: z.string().optional(),
  }),
  implementationDecisions: z.array(decisionSchema),
});
export type TaskContract = z.infer<typeof taskContractSchema>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Everything the approval covers; implementation decisions are deliberately outside it. */
export function contractHash(contract: TaskContract): string {
  const { taskId, repoPath, baseSha, profile, spec, permittedOperations, budgets } = contract;
  return createHash("sha256")
    .update(stableJson({ taskId, repoPath, baseSha, profile, spec, permittedOperations, budgets }))
    .digest("hex");
}

export function freezeContract(contract: TaskContract, now: Date): TaskContract {
  if (contract.approval.state === "approved") throw new Error("contract is already approved");
  const parsed = taskContractSchema.parse(contract);
  return { ...parsed, approval: { state: "approved", approvedAt: now.toISOString(), hash: contractHash(parsed) } };
}

export class ContractTamperedError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId}: the approved contract changed after approval`);
    this.name = "ContractTamperedError";
  }
}

export function assertFrozen(contract: TaskContract): void {
  if (contract.approval.state !== "approved" || contract.approval.hash !== contractHash(contract)) {
    throw new ContractTamperedError(contract.taskId);
  }
}

export function recordDecision(contract: TaskContract, stage: string, decision: string, now: Date): TaskContract {
  assertFrozen(contract);
  return {
    ...contract,
    implementationDecisions: [...contract.implementationDecisions, { at: now.toISOString(), stage, decision }],
  };
}
