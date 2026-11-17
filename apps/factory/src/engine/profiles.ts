/** Workflow profiles and deterministic routing; the simplest safe profile wins. */
import type { Budgets, ProfileName, Spec } from "#src/engine/contract";

export type Stage = "prepare" | "locate" | "reproduce" | "baseline" | "implement" | "verify" | "review" | "deliver";

export interface Profile {
  name: ProfileName;
  stages: readonly Stage[];
  budgets: Budgets;
}

const light: Budgets = { maxAgentTurns: 30, maxRepairPasses: 1, wallClockMinutes: 20, commandTimeoutSeconds: 300 };
const heavy: Budgets = { maxAgentTurns: 80, maxRepairPasses: 1, wallClockMinutes: 45, commandTimeoutSeconds: 600 };

export const PROFILES: Record<ProfileName, Profile> = {
  quick: { name: "quick", stages: ["prepare", "locate", "implement", "verify", "deliver"], budgets: light },
  bugfix: {
    name: "bugfix",
    stages: ["prepare", "locate", "reproduce", "implement", "verify", "deliver"],
    budgets: { ...heavy, maxRepairPasses: 2, wallClockMinutes: 60, commandTimeoutSeconds: 900 },
  },
  feature: { name: "feature", stages: ["prepare", "locate", "implement", "verify", "review", "deliver"], budgets: heavy },
  refactor: { name: "refactor", stages: ["prepare", "locate", "baseline", "implement", "verify", "review", "deliver"], budgets: heavy },
};

export const workflowVersion = (profile: Profile) => `${profile.name}@1`;

export type Route = { profile: ProfileName; reason: string; overridden: boolean };

function recommend(spec: Spec): { profile: ProfileName; reason: string } {
  if (spec.category === "bugfix") return { profile: "bugfix", reason: "a defect: regression-first flow" };
  if (spec.category === "refactor") return { profile: "refactor", reason: "structural change: baseline first" };
  const small = spec.estimatedFiles <= 3 && spec.risk === "low" && !spec.touchesSecurityOrData;
  if (small) return { profile: "quick", reason: `about ${spec.estimatedFiles} file(s), low risk` };
  const why = spec.touchesSecurityOrData ? "touches security or data" : `${spec.risk} risk, ~${spec.estimatedFiles} files`;
  return { profile: "feature", reason: why };
}

export function routeTask(spec: Spec, override?: ProfileName): Route {
  const recommended = recommend(spec);
  if (!override || override === recommended.profile) return { ...recommended, overridden: false };
  return { profile: override, reason: `user override (recommended ${recommended.profile}: ${recommended.reason})`, overridden: true };
}
