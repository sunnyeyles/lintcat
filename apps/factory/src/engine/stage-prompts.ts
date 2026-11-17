/** The prompts the engine hands the implementer at each stage. */
import type { CheckPlan } from "#src/engine/checks";
import type { TaskContract } from "#src/engine/contract";
import { renderMessage } from "#src/engine/prompts";

const tail = (text: string, chars: number) => (text.length > chars ? `…${text.slice(-chars)}` : text);

export interface FailedCheck {
  name: string;
  exitCode: number;
  timedOut: boolean;
  output: string;
}

function taskBlock(contract: TaskContract, located: unknown): string {
  const { spec } = contract;
  const frozen = {
    requirements: spec.requirements,
    acceptanceCriteria: spec.acceptanceCriteria,
    nonGoals: spec.nonGoals,
    constraints: spec.constraints,
    plan: spec.plan,
    architectureDecisions: spec.architectureDecisions,
    assumptions: spec.assumptions,
  };
  return renderMessage("implementer", "task", {
    title: spec.title,
    objective: spec.objective,
    spec: JSON.stringify(frozen, null, 2),
    located: JSON.stringify(located, null, 2),
  });
}

const checksBlock = (plan: CheckPlan) =>
  renderMessage("implementer", "checks", { checks: plan.checks.map((c) => `- ${c.name}: \`${c.command}\``).join("\n") });

export function reproducePrompt(contract: TaskContract, located: unknown, plan: CheckPlan): string {
  return [taskBlock(contract, located), checksBlock(plan), "", renderMessage("implementer", "reproduce")].join("\n");
}

export interface ImplementContext {
  located: unknown;
  regression?: { testFiles: string[]; failing: string[] } | undefined;
  baselineFailing?: string[] | undefined;
  placement: boolean;
}

export function implementPrompt(contract: TaskContract, context: ImplementContext, plan: CheckPlan): string {
  const lines = [taskBlock(contract, context.located), checksBlock(plan), ""];
  if (context.regression) {
    lines.push(
      renderMessage("implementer", "implement-regression", {
        testFiles: context.regression.testFiles.join(", "),
        failing: context.regression.failing.join(", "),
      }),
    );
  }
  if (context.baselineFailing?.length) {
    lines.push(renderMessage("implementer", "implement-baseline", { failing: context.baselineFailing.join(", ") }));
  }
  if (context.placement) lines.push(renderMessage("implementer", "implement-placement"));
  lines.push(renderMessage("implementer", "implement"));
  return lines.join("\n");
}

export function repairPrompt(failures: readonly FailedCheck[], pass: number, max: number): string {
  const rendered = failures.map((f) =>
    renderMessage("implementer", "repair-failure", {
      name: f.name,
      exitCode: f.exitCode,
      timedOut: f.timedOut ? ", timed out" : "",
      output: tail(f.output, 6000),
    }),
  );
  return renderMessage("implementer", "repair", { pass, max, failures: rendered.join("\n") });
}
