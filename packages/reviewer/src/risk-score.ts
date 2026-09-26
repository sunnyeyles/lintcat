/** How risky a change is, scored 0–100 from its blast radius. */
import type { Impact } from "@pr-review/index";
import { countLabel, type RiskBand } from "@pr-review/schemas";

/** Each factor's caps sum to 100, so the score needs no clamping. */
export const RISK_WEIGHTS = {
  dependents: { max: 50, saturatesAt: 64 },
  packages: { each: 8, max: 15 },
  entryPoints: { each: 5, max: 10 },
  untested: { each: 5, max: 10 },
  brokenImporters: { each: 5, max: 10 },
  cycle: 5,
  // Saturated dependents across 3 packages reach high alone; 7 dependents reach medium.
  bands: { mediumFrom: 25, highFrom: 60 },
} as const;

interface RiskFactor {
  readonly label: string;
  readonly points: number;
}

export interface RiskScore {
  readonly score: number;
  readonly band: RiskBand;
  /** Strongest first; factors worth nothing are left out. */
  readonly factors: readonly RiskFactor[];
  readonly partial: boolean;
}

const perItem = (n: number, weight: { each: number; max: number }): number =>
  Math.min(weight.max, weight.each * n);

function dependentPoints(n: number): number {
  const { max, saturatesAt } = RISK_WEIGHTS.dependents;
  return Math.round(
    max * Math.min(1, Math.log2(1 + n) / Math.log2(1 + saturatesAt)),
  );
}

function bandOf(score: number): RiskBand {
  const { mediumFrom, highFrom } = RISK_WEIGHTS.bands;
  return score >= highFrom ? "high" : score >= mediumFrom ? "medium" : "low";
}

/** Uses `impact.counts`, since the path lists are capped. */
export function scoreRisk(impact: Impact): RiskScore {
  const { counts } = impact;
  const packages = impact.packages.length;
  const candidates: RiskFactor[] = [
    {
      label: `${countLabel(counts.transitive, "file depends", "files depend")} on this change`,
      points: dependentPoints(counts.transitive),
    },
    {
      label: `crosses ${packages} packages`,
      points: perItem(Math.max(0, packages - 1), RISK_WEIGHTS.packages),
    },
    {
      label: `reaches ${countLabel(counts.entryPoints, "entry point", "entry points")}`,
      points: perItem(counts.entryPoints, RISK_WEIGHTS.entryPoints),
    },
    {
      label: `${countLabel(counts.untested, "changed source file has", "changed source files have")} no tests`,
      points: perItem(counts.untested, RISK_WEIGHTS.untested),
    },
    {
      label: `breaks ${countLabel(counts.brokenImporters, "import", "imports")}`,
      points: perItem(counts.brokenImporters, RISK_WEIGHTS.brokenImporters),
    },
    {
      label: "touches an import cycle",
      points: counts.inCycle > 0 ? RISK_WEIGHTS.cycle : 0,
    },
  ];
  const factors = candidates
    .filter((factor) => factor.points > 0)
    .sort((a, b) => b.points - a.points);
  const score = factors.reduce((sum, factor) => sum + factor.points, 0);
  return { score, band: bandOf(score), factors, partial: impact.partial };
}
