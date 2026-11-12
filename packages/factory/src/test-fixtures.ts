import type { Spec } from "#src/contract";

export const sampleSpec: Spec = {
  title: "Add a --version flag",
  objective: "Print the version",
  category: "quick",
  requirements: ["--version prints the package version"],
  nonGoals: [],
  constraints: [],
  acceptanceCriteria: [{ id: "AC1", text: "Given the CLI, when run with --version, then it prints the version", verification: "automated" }],
  plan: ["Edit src/cli.ts"],
  architectureDecisions: [],
  repositoryFindings: [],
  assumptions: [],
  estimatedFiles: 2,
  risk: "low",
  touchesSecurityOrData: false,
};
