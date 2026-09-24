import type { Impact } from "@pr-review/index";
import type { ReviewFinding } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import type { BlastRadius } from "#src/blast-radius";
import {
  MAX_ANNOTATIONS_PER_REQUEST,
  renderCheckRun,
} from "#src/render-check-run";

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    file: "src/orders/service.ts",
    line: 42,
    category: "correctness",
    severity: "medium",
    title: "API failures returned as empty results",
    explanation: "API failures are being returned as empty results.",
    confidence: 0.85,
    ...overrides,
  };
}

describe("renderCheckRun with no findings", () => {
  it("renders a clean success check run", () => {
    const rendered = renderCheckRun([], { annotate: true });

    expect(rendered.conclusion).toBe("success");
    expect(rendered.output.title).toMatch(/no issues found/i);
    expect(rendered.output.summary).toMatch(/no issues/i);
  });

  it("carries no annotations", () => {
    const rendered = renderCheckRun([], { annotate: true });

    expect(rendered.output.annotations).toBeUndefined();
  });
});

describe("renderCheckRun with findings", () => {
  const security = finding({
    file: "src/auth/session.ts",
    line: 84,
    category: "security",
    severity: "high",
    title: "Missing tenant validation",
    explanation:
      "Missing tenant validation could allow access to another tenant's session.",
    suggestedFix: "Filter the session query by the authenticated tenant id.",
    confidence: 0.9,
  });
  const correctness = finding();

  it("publishes a neutral conclusion so advisory findings do not block merges", () => {
    expect(renderCheckRun([security, correctness], { annotate: true }).conclusion).toBe("neutral");
  });

  it("counts the findings in the title, with singular and plural forms", () => {
    expect(renderCheckRun([security], { annotate: true }).output.title).toBe("1 finding");
    expect(renderCheckRun([security, correctness], { annotate: true }).output.title).toBe(
      "2 findings",
    );
  });

  it("lists every finding in the summary with severity, category, location, and explanation", () => {
    const { output } = renderCheckRun([security, correctness], { annotate: true });

    expect(output.summary).toContain("HIGH — Security");
    expect(output.summary).toContain("src/auth/session.ts:84");
    expect(output.summary).toContain("Missing tenant validation");
    expect(output.summary).toContain(
      "Missing tenant validation could allow access to another tenant's session.",
    );
    expect(output.summary).toContain("MEDIUM — Correctness");
    expect(output.summary).toContain("src/orders/service.ts:42");
    expect(output.summary).toContain(
      "API failures are being returned as empty results.",
    );
  });

  it("orders the summary by severity, then confidence", () => {
    const low = finding({
      severity: "low",
      title: "Low severity note",
      confidence: 0.99,
    });
    const { output } = renderCheckRun([low, correctness, security], { annotate: true });

    const highIndex = output.summary.indexOf("HIGH — Security");
    const mediumIndex = output.summary.indexOf("MEDIUM — Correctness");
    const lowIndex = output.summary.indexOf("LOW — Correctness");
    expect(highIndex).toBeGreaterThanOrEqual(0);
    expect(mediumIndex).toBeGreaterThan(highIndex);
    expect(lowIndex).toBeGreaterThan(mediumIndex);
  });

  it("includes the suggested fix in the summary when present", () => {
    const { output } = renderCheckRun([security], { annotate: true });

    expect(output.summary).toContain(
      "Filter the session query by the authenticated tenant id.",
    );
  });

  it("renders a file-level finding without a line suffix", () => {
    const { line: _line, ...fileLevel } = finding({
      title: "File-level architecture concern",
      category: "architecture",
    });
    const { output } = renderCheckRun([fileLevel], { annotate: true });

    expect(output.summary).toContain("src/orders/service.ts");
    expect(output.summary).not.toContain("src/orders/service.ts:");
  });

  it("annotates line-anchored findings and skips file-level ones", () => {
    const { line: _line, ...fileLevel } = finding({
      title: "File-level architecture concern",
      category: "architecture",
    });
    const { output } = renderCheckRun([security, fileLevel], { annotate: true });

    expect(output.annotations).toEqual([
      {
        path: "src/auth/session.ts",
        start_line: 84,
        end_line: 84,
        annotation_level: "failure",
        title: "Missing tenant validation",
        message:
          "Missing tenant validation could allow access to another tenant's session." +
          "\n\nSuggested fix: Filter the session query by the authenticated tenant id.",
      },
    ]);
  });

  it("omits the annotations field when no finding is line-anchored", () => {
    const { line: _line, ...fileLevel } = finding();
    const { output } = renderCheckRun([fileLevel], { annotate: true });

    expect(output.annotations).toBeUndefined();
  });

  it("maps severity to the annotation level", () => {
    const { output } = renderCheckRun([
      finding({ severity: "high", title: "High" }),
      finding({ severity: "medium", title: "Medium" }),
      finding({ severity: "low", title: "Low" }),
    ], { annotate: true });

    expect(output.annotations?.map((a) => a.annotation_level)).toEqual([
      "failure",
      "warning",
      "notice",
    ]);
  });

  it("annotates the explanation without a fix suffix when no fix is suggested", () => {
    const { output } = renderCheckRun([correctness], { annotate: true });

    expect(output.annotations?.[0]?.message).toBe(
      "API failures are being returned as empty results.",
    );
  });

  it("caps annotations at 50 per request, keeping the strongest findings", () => {
    expect(MAX_ANNOTATIONS_PER_REQUEST).toBe(50);
    const many = Array.from({ length: 55 }, (_, i) =>
      finding({
        line: i + 1,
        severity: i === 54 ? "high" : "low",
        title: `Finding ${i}`,
        confidence: 0.7 + i * 0.005,
      }),
    );

    const { output } = renderCheckRun(many, { annotate: true });

    expect(output.annotations).toHaveLength(50);
    // The single high-severity finding sorts first despite being last in.
    expect(output.annotations?.[0]?.title).toBe("Finding 54");
    expect(output.annotations?.[0]?.start_line).toBe(55);
  });
});

describe("renderCheckRun with findings carried from earlier commits", () => {
  const carried = [
    {
      key: "src/auth.ts|missing tenant scope",
      file: "src/auth.ts",
      title: "missing tenant scope",
      category: "security",
      heading: "HIGH — Security: Missing tenant scope",
    },
  ];

  it("is never a success, even with nothing new to report", () => {
    const rendered = renderCheckRun([], {
      annotate: false,
      carriedForward: carried,
    });

    expect(rendered.conclusion).toBe("neutral");
    expect(rendered.output.title).toBe("1 finding open from earlier commits");
  });

  it("names each one where it stands", () => {
    const rendered = renderCheckRun([], {
      annotate: false,
      carriedForward: carried,
    });

    expect(rendered.output.summary).toContain(
      "HIGH — Security: Missing tenant scope",
    );
    expect(rendered.output.summary).toContain("src/auth.ts");
  });

  it("falls back to the marker's title when the comment had no heading", () => {
    const rendered = renderCheckRun([], {
      annotate: false,
      carriedForward: [{ ...carried[0]!, heading: undefined }],
    });

    expect(rendered.output.summary).toContain("Security: missing tenant scope");
  });

  it("lists them alongside this run's own findings", () => {
    const rendered = renderCheckRun([finding()], {
      annotate: false,
      carriedForward: carried,
    });

    expect(rendered.output.title).toBe("1 finding");
    expect(rendered.output.summary).toContain("still open from earlier commits");
  });

  it("carries the scope note last, so what was read is on the record", () => {
    const rendered = renderCheckRun([], {
      annotate: false,
      scopeNote: "> **Note:** read only what changed since `abc1234`.",
    });

    expect(rendered.output.summary).toContain("since `abc1234`");
  });
});

describe("renderCheckRun with a blast radius", () => {
  const impact: Impact = {
    direct: [],
    transitive: [],
    packages: ["@app/api", "@app/core", "@app/web"],
    entryPoints: [],
    untested: [],
    inCycle: [],
    brokenImporters: [],
    partial: false,
    hubs: [
      { path: "packages/core/src/db.ts", dependents: 30 },
      { path: "packages/core/src/auth.ts", dependents: 1 },
    ],
    counts: {
      direct: 12,
      transitive: 41,
      entryPoints: 2,
      untested: 0,
      inCycle: 0,
      brokenImporters: 0,
    },
  };
  const blastRadius: BlastRadius = {
    impact,
    risk: {
      score: 78,
      band: "high",
      factors: [
        { label: "41 files depend on this change", points: 31 },
        { label: "crosses 3 packages", points: 16 },
      ],
      partial: false,
    },
  };

  it("leads the summary with the band, score and reach", () => {
    const { output } = renderCheckRun([finding()], {
      annotate: false,
      blastRadius,
    });

    expect(output.summary.split("\n")[0]).toBe(
      "**Blast radius: High (78)** · 41 files in 3 packages depend on this change",
    );
    expect(output.summary).toContain(
      "`packages/core/src/db.ts` — 30 dependents",
    );
    expect(output.summary).toContain(
      "`packages/core/src/auth.ts` — 1 dependent",
    );
    expect(output.summary).toMatch(
      /<details><summary>[^<]+<\/summary>\n\n- 41 files depend on this change \(\+31\)/,
    );
    expect(output.summary).toContain("<sub>Static imports only.</sub>");
  });

  it("never changes the conclusion", () => {
    expect(
      renderCheckRun([], { annotate: false, blastRadius }).conclusion,
    ).toBe("success");
    expect(
      renderCheckRun([finding()], { annotate: false, blastRadius }).conclusion,
    ).toBe("neutral");
  });

  it("says so when nothing depends on the change", () => {
    const { output } = renderCheckRun([], {
      annotate: false,
      blastRadius: {
        impact: {
          ...impact,
          hubs: [],
          counts: { ...impact.counts, direct: 0, transitive: 0 },
        },
        risk: { score: 0, band: "low", factors: [], partial: false },
      },
    });

    expect(output.summary).toContain(
      "**Blast radius: Low (0)** · no indexed files depend on this change",
    );
    expect(output.summary).not.toContain("<details>");
  });

  it("flags a partial graph in the footnote", () => {
    const { output } = renderCheckRun([], {
      annotate: false,
      blastRadius: {
        ...blastRadius,
        risk: { ...blastRadius.risk, partial: true },
      },
    });

    expect(output.summary).toContain(
      "Static imports only. Partial: archive truncated or unindexed language.",
    );
  });

  it("is absent without an index", () => {
    const { output } = renderCheckRun([finding()], { annotate: false });

    expect(output.summary).not.toContain("Blast radius");
  });
});
