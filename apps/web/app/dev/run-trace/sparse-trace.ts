import type { AgentNode, RunTrace } from "@/lib/run-trace/types";

const at = (seconds: number) => new Date(Date.parse("2026-11-10T09:00:00.000Z") + seconds * 1000).toISOString();

function stageAgent(
  id: string,
  role: string,
  stage: string,
  start: number,
  end: number,
  extra: Partial<AgentNode> = {},
): AgentNode {
  return {
    id,
    role,
    stage,
    startedAt: at(start),
    endedAt: at(end),
    steps: [],
    filesRead: [],
    filesEdited: [],
    context: [],
    children: [],
    ...extra,
  };
}

// A source with nothing but stages and pass/fail events: no steps, context or files.
export const SPARSE_TRACE: RunTrace = {
  sessionId: "sparse-fixture",
  title: "Sparse pipeline (fixture)",
  root: stageAgent("p-root", "pipeline", "", 0, 300, {
    stage: undefined,
    children: [
      stageAgent("p-plan", "ci-planner", "plan", 0, 20, {
        events: [
          {
            kind: "check",
            label: "Ticket parsed",
            timestamp: at(18),
            ok: true,
          },
        ],
      }),
      stageAgent("p-lint", "ci-linter", "check", 22, 60, {
        description: "Lint the diff",
        events: [
          { kind: "command", label: "eslint .", timestamp: at(30), ok: true },
          {
            kind: "command",
            label: "prettier --check",
            timestamp: at(55),
            ok: true,
          },
        ],
        costUsd: 0.0123,
      }),
      stageAgent("p-types", "typechecker", "check", 23, 80, {
        events: [
          {
            kind: "command",
            label: "tsc --noEmit",
            timestamp: at(78),
            ok: false,
          },
        ],
      }),
      stageAgent("p-test", "ci-tester", "test", 85, 200, {
        description: "Unit tests",
        events: [{ kind: "check", label: "vitest run", timestamp: at(190), ok: true }],
      }),
      stageAgent("p-ship", "deployer", "ship", 210, 300, { status: "running" }),
    ],
  }),
};
