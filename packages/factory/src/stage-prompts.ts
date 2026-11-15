/** The prompts the engine hands the implementer at each stage; the wording lives in agents/implementer/. */
import type { CheckPlan } from "#src/checks";
import type { TaskContract } from "#src/contract";
import { renderMessage } from "#src/prompts";
import { renderArchitecture, type ArchitectureBrief } from "#src/repository";

const tail = (text: string, chars: number) => (text.length > chars ? `…${text.slice(-chars)}` : text);

export interface FailedCheck {
  name: string;
  exitCode: number;
  timedOut: boolean;
  output: string;
}

function contextBlock(contract: TaskContract, located: unknown, architecture: ArchitectureBrief | undefined, plan: CheckPlan): string[] {
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
  return [
    renderMessage("implementer", "task", {
      title: spec.title,
      objective: spec.objective,
      spec: JSON.stringify(frozen, null, 2),
      located: JSON.stringify(located, null, 2),
    }),
    ...(architecture ? [renderMessage("implementer", "architecture", { brief: renderArchitecture(architecture) })] : []),
    renderMessage("implementer", "checks", { checks: plan.checks.map((c) => `- ${c.name}: \`${c.command}\``).join("\n") }),
    "",
  ];
}

export function reproducePrompt(contract: TaskContract, located: unknown, plan: CheckPlan): string {
  return [...contextBlock(contract, located, undefined, plan), renderMessage("implementer", "reproduce")].join("\n");
}

export interface ImplementContext {
  located: unknown;
  architecture?: ArchitectureBrief | undefined;
  regression?: { testFiles: string[]; failing: string[] } | undefined;
  baselineFailing?: string[] | undefined;
  placement: boolean;
}

export function implementPrompt(contract: TaskContract, context: ImplementContext, plan: CheckPlan): string {
  const lines = contextBlock(contract, context.located, context.architecture, plan);
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
