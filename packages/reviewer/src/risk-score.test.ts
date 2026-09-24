import type { Impact, ImpactCounts } from "@pr-review/index";
import { describe, expect, it } from "vitest";

import { RISK_WEIGHTS, scoreRisk, type RiskScore } from "#src/risk-score";

const none: ImpactCounts = {
  direct: 0,
  transitive: 0,
  entryPoints: 0,
  untested: 0,
  inCycle: 0,
  brokenImporters: 0,
};

// Path lists stay empty: the score must come from `counts` alone.
function impactOf(
  counts: Partial<ImpactCounts>,
  packages: readonly string[] = ["@app/web"],
  partial = false,
): Impact {
  return {
    direct: [],
    transitive: [],
    packages,
    entryPoints: [],
    untested: [],
    inCycle: [],
    brokenImporters: [],
    partial,
    hubs: [],
    counts: { ...none, ...counts },
  };
}

const sumOf = (risk: RiskScore): number =>
  risk.factors.reduce((sum, factor) => sum + factor.points, 0);

describe("scoreRisk", () => {
  it("scores an empty impact as zero, low, with no factors", () => {
    expect(scoreRisk(impactOf({}, []))).toEqual({
      score: 0,
      band: "low",
      factors: [],
      partial: false,
    });
  });

  it("rates a leaf-only change low", () => {
    const risk = scoreRisk(impactOf({ untested: 1 }));

    expect(risk.band).toBe("low");
    expect(risk.factors).toEqual([
      { label: "1 changed source file has no tests", points: 5 },
    ]);
  });

  it("rates a hub with 41 dependents across 3 packages, reaching entry points, high", () => {
    const risk = scoreRisk(
      impactOf({ direct: 12, transitive: 41, entryPoints: 3, untested: 2 }, [
        "@app/api",
        "@app/web",
        "@pkg/core",
      ]),
    );

    expect(risk.band).toBe("high");
    expect(risk.score).toBe(72);
    expect(risk.factors).toEqual([
      { label: "41 files depend on this change", points: 31 },
      { label: "crosses 3 packages", points: 16 },
      { label: "reaches 3 entry points", points: 15 },
      { label: "2 changed source files have no tests", points: 10 },
    ]);
  });

  it("reads true totals from counts, not the capped lists", () => {
    const impact = {
      ...impactOf({ transitive: 500 }),
      transitive: Array.from({ length: 200 }, (_, at) => `src/f${at}.ts`),
    };

    expect(scoreRisk(impact).factors[0]).toEqual({
      label: "500 files depend on this change",
      points: RISK_WEIGHTS.dependents.max,
    });
  });

  it("makes the factors sum exactly to the score", () => {
    const impacts = [
      impactOf({ transitive: 1 }),
      impactOf({ transitive: 7, brokenImporters: 1, inCycle: 2 }, ["a", "b"]),
      impactOf({ transitive: 23, entryPoints: 1, untested: 4 }, [
        "a",
        "b",
        "c",
        "d",
      ]),
      impactOf({ transitive: 63, brokenImporters: 9 }),
    ];

    for (const impact of impacts) {
      const risk = scoreRisk(impact);
      expect(sumOf(risk)).toBe(risk.score);
      expect(
        risk.factors.every((factor) => Number.isInteger(factor.points)),
      ).toBe(true);
    }
  });

  it("orders factors strongest first and drops zero-point ones", () => {
    const risk = scoreRisk(
      impactOf({ transitive: 1, brokenImporters: 2, inCycle: 1 }),
    );

    expect(risk.factors.map((factor) => factor.points)).toEqual([10, 6, 5]);
    expect(risk.factors.map((factor) => factor.label)).toEqual([
      "breaks 2 imports",
      "1 file depends on this change",
      "touches an import cycle",
    ]);
  });

  it("stops at 100 when every factor saturates", () => {
    const risk = scoreRisk(
      impactOf(
        {
          direct: 900,
          transitive: 5000,
          entryPoints: 80,
          untested: 80,
          inCycle: 40,
          brokenImporters: 80,
        },
        Array.from({ length: 30 }, (_, at) => `@pkg/p${at}`),
      ),
    );

    expect(risk.score).toBe(100);
    expect(risk.band).toBe("high");
    expect(sumOf(risk)).toBe(100);
  });

  it("puts the band edges at 35 and 70", () => {
    const fourPackages = ["a", "b", "c", "d"];
    const cases = [
      [impactOf({ transitive: 9, entryPoints: 3 }), 34, "low"],
      [impactOf({ transitive: 10, entryPoints: 3 }), 35, "medium"],
      [
        impactOf({ transitive: 9, entryPoints: 3, untested: 3 }, fourPackages),
        69,
        "medium",
      ],
      [
        impactOf({ transitive: 10, entryPoints: 3, untested: 3 }, fourPackages),
        70,
        "high",
      ],
    ] as const;

    for (const [impact, score, band] of cases) {
      expect(scoreRisk(impact)).toMatchObject({ score, band });
    }
  });

  it("carries partial from the impact", () => {
    expect(scoreRisk(impactOf({}, [], true)).partial).toBe(true);
  });
});
