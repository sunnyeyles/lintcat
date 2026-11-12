/** Discovery in the terminal: one question at a time, then propose, render and decide. */
import type { DiscoveryIO, FactoryService, ProfileName, ReviewDecision, Spec } from "@pr-review/factory";

import { renderSpec } from "#src/render";

export interface TerminalIOOptions {
  service: FactoryService;
  repoPath: string;
  profile: ProfileName | undefined;
  allowPullRequest: boolean;
  ask: (prompt: string) => Promise<string>;
  out: (text: string) => void;
  progress: (text: string) => void;
  promptVersion: () => string;
}

export interface TerminalIO extends DiscoveryIO {
  /** The run the last proposal created or updated, once there is one. */
  runId(): string | undefined;
}

const brief = (items: readonly string[], max = 4) =>
  items.slice(0, max).map((item) => `  · ${item}`).concat(items.length > max ? [`  · (${items.length - max} more)`] : []);

export function createTerminalIO(options: TerminalIOOptions): TerminalIO {
  const { service, out } = options;
  let runId: string | undefined;

  async function choose(blocked: boolean): Promise<"a" | "r" | "q"> {
    const prompt = blocked ? "[r]evise / [q]uit > " : "[a]pprove / [r]evise / [q]uit > ";
    for (;;) {
      const answer = (await options.ask(prompt)).trim().toLowerCase().charAt(0);
      if (answer === "r" || answer === "q" || (answer === "a" && !blocked)) return answer;
    }
  }

  async function revise(): Promise<ReviewDecision> {
    const feedback = (await options.ask("What should change? > ")).trim();
    return feedback ? { decision: "revise", feedback } : { decision: "revise", feedback: "Reconsider the spec and tighten it." };
  }

  return {
    runId: () => runId,

    async ask(turn) {
      if (turn.facts.length) out(["Found:", ...brief(turn.facts)].join("\n"));
      if (turn.assumptions.length) out(["Assuming:", ...brief(turn.assumptions)].join("\n"));
      out(`\n? ${turn.question}`);
      const answer = (await options.ask("> ")).trim();
      return answer || "(no answer: use your best judgement and record it as an assumption)";
    },

    async review(spec: Spec): Promise<ReviewDecision> {
      const { run, route } = await service.propose({
        repoPath: options.repoPath,
        spec,
        promptVersion: options.promptVersion(),
        allowPullRequest: options.allowPullRequest,
        ...(options.profile ? { profileOverride: options.profile } : {}),
        ...(runId ? { runId } : {}),
      });
      runId = run.id;
      out(`\n${renderSpec(spec, route, run.id)}\n`);
      let blocked = !route.ok;
      if (!route.ok) out(`This spec cannot be approved: ${route.blocker}`);
      for (;;) {
        const choice = await choose(blocked);
        if (choice === "q") return { decision: "abort" };
        if (choice === "r") return revise();
        try {
          await service.approve(run.id);
          out(`Approved ${run.id}.`);
          return { decision: "approve" };
        } catch (error) {
          out(`Cannot approve: ${error instanceof Error ? error.message : String(error)}`);
          blocked = true;
        }
      }
    },

    progress: options.progress,
  };
}
