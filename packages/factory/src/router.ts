/** Deterministic profile routing; the simplest safe profile wins. */
import type { ProfileName, Spec } from "#src/contract";
import type { Profile } from "#src/profiles";

export type Route =
  | { ok: true; profile: ProfileName; reason: string; overridden: boolean }
  | { ok: false; blocker: string };

function recommend(spec: Spec): { profile: ProfileName; reason: string } {
  if (spec.category === "bugfix") return { profile: "bugfix", reason: "a defect: regression-first flow" };
  if (spec.category === "refactor") return { profile: "refactor", reason: "structural change: baseline first" };
  const small = spec.estimatedFiles <= 3 && spec.risk === "low" && !spec.touchesSecurityOrData;
  if (small) return { profile: "quick", reason: `about ${spec.estimatedFiles} file(s), low risk` };
  const why = spec.touchesSecurityOrData ? "touches security or data" : `${spec.risk} risk, ~${spec.estimatedFiles} files`;
  return { profile: "feature", reason: why };
}

export function routeTask(spec: Spec, profiles: Profile[], override?: ProfileName): Route {
  const byName = new Map(profiles.map((p) => [p.name, p]));
  const recommended = recommend(spec);
  let chosen = recommended.profile;
  let reason = recommended.reason;
  if (override && override !== chosen) {
    const lighter = (byName.get(override)?.weight ?? 0) < (byName.get(chosen)?.weight ?? 0);
    if (lighter && (spec.risk !== "low" || spec.touchesSecurityOrData)) {
      return { ok: false, blocker: `${override} is lighter than ${chosen}, which this ${spec.risk}-risk task needs` };
    }
    chosen = override;
    reason = `user override (recommended ${recommended.profile}: ${recommended.reason})`;
  }
  const profile = byName.get(chosen);
  if (!profile?.enabled) {
    return { ok: false, blocker: `profile ${chosen} is not enabled yet (${reason})` };
  }
  return { ok: true, profile: chosen, reason, overridden: chosen !== recommended.profile };
}
