import { makeFinding } from "@pr-review/ai/agent-test-support";
import { describe, expect, it } from "vitest";

import {
  blockingFindings,
  orderFindings,
  renderFinding,
  renderSummary,
  wrap,
} from "#src/render";

const plain = { color: false };

describe("a finding in a terminal", () => {
  it("leads with the severity, the agent and one location", () => {
    const finding = makeFinding("security", {
      file: "src/sessions.ts",
      line: 12,
      title: "Session token is logged",
      explanation: "The token reaches the log line.",
      suggestedFix: "Redact it.",
    });

    const lines = renderFinding(finding, plain).split("\n");

    expect(lines[0]).toBe("HIGH   Security src/sessions.ts:12");
    expect(lines[1]).toBe("  Session token is logged");
    expect(lines).toContain("  The token reaches the log line.");
    expect(lines).toContain("  Fix: Redact it.");
  });

  it("names the file alone when the finding has no line", () => {
    const finding = makeFinding("general", { file: "README.md", line: undefined });

    expect(renderFinding(finding, plain).split("\n")[0]).toContain("README.md");
    expect(renderFinding(finding, plain)).not.toContain("README.md:");
  });

  it("colours the severity only when colour is on", () => {
    const finding = makeFinding("general");

    expect(renderFinding(finding, { color: true })).toContain("\u001b[");
    expect(renderFinding(finding, plain)).not.toContain("\u001b[");
  });

  it("wraps prose at the terminal width, keeping the indent", () => {
    const lines = wrap("word ".repeat(40).trim(), "  ");

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.startsWith("  ") && line.length <= 88)).toBe(true);
  });
});

describe("what blocks", () => {
  const findings = [
    makeFinding("general", { severity: "low" }),
    makeFinding("security", { severity: "high" }),
    makeFinding("correctness", { severity: "medium" }),
  ];

  it("counts a finding at or above the threshold", () => {
    expect(blockingFindings(findings, "high")).toHaveLength(1);
    expect(blockingFindings(findings, "medium")).toHaveLength(2);
    expect(blockingFindings(findings, "low")).toHaveLength(3);
  });

  it("blocks on nothing when the threshold is off", () => {
    expect(blockingFindings(findings, "off")).toEqual([]);
  });

  it("puts the highest severity first", () => {
    expect(orderFindings(findings).map((finding) => finding.severity)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });
});

describe("the summary", () => {
  it("says nothing was found", () => {
    const summary = renderSummary(
      { findings: [], blocking: [], failOn: "high", suppressed: 0 },
      plain,
    );

    expect(summary).toBe("No findings.");
  });

  it("counts by severity and names what blocks", () => {
    const findings = [makeFinding("security"), makeFinding("general", { severity: "low" })];

    const summary = renderSummary(
      {
        findings,
        blocking: blockingFindings(findings, "high"),
        failOn: "high",
        suppressed: 2,
      },
      plain,
    );

    expect(summary).toContain("2 finding(s): 1 high, 1 low.");
    expect(summary).toContain("Blocked: 1 finding(s) at or above high.");
    expect(summary).toContain("2 finding(s) hidden");
  });
});
