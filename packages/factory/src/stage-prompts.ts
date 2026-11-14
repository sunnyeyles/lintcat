/** The prompts the engine hands the implementer at each stage. */
import type { CheckPlan } from "#src/checks";
import type { TaskContract } from "#src/contract";
import { renderArchitecture, type ArchitectureBrief } from "#src/repository";

const tail = (text: string, chars: number) => (text.length > chars ? `…${text.slice(-chars)}` : text);

export interface FailedCheck {
  name: string;
  exitCode: number;
  timedOut: boolean;
  output: string;
}

function specBlock(contract: TaskContract): string[] {
  const { spec } = contract;
  return [
    `# Task: ${spec.title}`,
    `Objective: ${spec.objective}`,
    "## Approved specification (frozen)",
    "```json",
    JSON.stringify(
      {
        requirements: spec.requirements,
        acceptanceCriteria: spec.acceptanceCriteria,
        nonGoals: spec.nonGoals,
        constraints: spec.constraints,
        plan: spec.plan,
        architectureDecisions: spec.architectureDecisions,
        assumptions: spec.assumptions,
      },
      null,
      2,
    ),
    "```",
  ];
}

function contextBlock(located: unknown, architecture: ArchitectureBrief | undefined): string[] {
  const lines = ["## Where to look first", "```json", JSON.stringify(located, null, 2), "```"];
  if (architecture) lines.push("## Architecture brief (repository intelligence)", renderArchitecture(architecture));
  return lines;
}

const checksBlock = (plan: CheckPlan) => [
  "## Checks the factory runs afterwards",
  ...plan.checks.map((c) => `- ${c.name}: \`${c.command}\``),
  "",
];

export function reproducePrompt(contract: TaskContract, located: unknown, plan: CheckPlan): string {
  return [
    ...specBlock(contract),
    ...contextBlock(located, undefined),
    ...checksBlock(plan),
    "Reproduce the bug now: diagnose it, then write a regression test that fails because of it.",
    "Change test files only and don't fix the bug yet. If no test can reproduce it, change nothing and answer `not_reproducible` with the reason.",
  ].join("\n");
}

export interface ImplementContext {
  located: unknown;
  architecture?: ArchitectureBrief | undefined;
  regression?: { testFiles: string[]; failing: string[] } | undefined;
  baselineFailing?: string[] | undefined;
  placement: boolean;
  suggestRefactors?: boolean;
}

export function implementPrompt(contract: TaskContract, context: ImplementContext, plan: CheckPlan): string {
  const lines = [...specBlock(contract), ...contextBlock(context.located, context.architecture), ...checksBlock(plan)];
  if (context.regression) {
    lines.push(
      `Your regression test (${context.regression.testFiles.join(", ")}) fails in ${context.regression.failing.join(", ")}. Fix the bug so it passes; never weaken or delete it.`,
    );
  }
  if (context.baselineFailing?.length) {
    lines.push(`These checks already fail at the base commit and are not blamed on you: ${context.baselineFailing.join(", ")}. Every other check must keep passing.`);
  }
  if (context.placement) {
    lines.push("Before writing code, compare extending a candidate module with adding a new one. Report the choice in `placement`.");
  }
  if (context.suggestRefactors) {
    lines.push(
      "Keep the fix minimal. If the code around the bug invites a refactor that would prevent this class of bug, describe up to 3 in `refactors`, but don't make them. Answer `[]` if none is worth it.",
    );
  }
  lines.push("Implement the task now. Use `sandbox_exec` for targeted checks.");
  return lines.join("\n");
}

export function repairPrompt(failures: readonly FailedCheck[], pass: number, max: number): string {
  return [
    `Repair pass ${pass} of ${max}. These mandatory checks failed after your change:`,
    ...failures.map((f) =>
      [`## ${f.name} (exit ${f.exitCode}${f.timedOut ? ", timed out" : ""})`, "```", tail(f.output, 6000), "```"].join("\n"),
    ),
    "Fix the cause, rerun the failing checks with `sandbox_exec`, then give your final answer.",
  ].join("\n");
}
