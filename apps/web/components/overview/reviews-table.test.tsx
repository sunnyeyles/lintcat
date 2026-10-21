import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { REPO_HISTORY_COLUMNS, ReviewsTable } from "@/components/overview";

import type { ReviewRow } from "./reviews-table";

function review(id: string, costUsd: number, createdAt: Date): ReviewRow {
  return {
    id,
    prNumber: 42,
    headSha: `${id}abcdef0123456789`,
    bySeverity: { low: 1, medium: 0, high: 0 },
    durationMs: 61_000,
    costUsd,
    createdAt,
    repo: { owner: "acme", name: "widgets" },
    risk: null,
  };
}

function render(): string {
  return renderToStaticMarkup(
    <ReviewsTable
      slug="acme"
      caption="Review history"
      columns={REPO_HISTORY_COLUMNS}
      groupByPullRequest
      rows={[
        review("bbbbbbb", 0.12, new Date("2026-10-20T12:00:00Z")),
        review("aaaaaaa", 0.0042, new Date("2026-10-19T12:00:00Z")),
      ]}
    />,
  );
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function headerCells(markup: string): string[] {
  const thead = markup.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? "";
  return [...thead.matchAll(/<th\b[^>]*>[\s\S]*?<\/th>/g)].map((m) => m[0]);
}

function rows(markup: string): string[] {
  const tbodies = [...markup.matchAll(/<tbody[\s\S]*?<\/tbody>/g)].map((m) => m[0]).join("");
  return [...tbodies.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((m) => m[0]);
}

describe("REPO_HISTORY_COLUMNS", () => {
  it("AC1: is exactly pullRequest, head, risk, findings, duration, cost, ran in order", () => {
    expect([...REPO_HISTORY_COLUMNS]).toEqual([
      "pullRequest",
      "head",
      "risk",
      "findings",
      "duration",
      "cost",
      "ran",
    ]);
  });
});

describe("ReviewsTable with REPO_HISTORY_COLUMNS", () => {
  it("AC3: renders the headers in order, Cost between Duration and When", () => {
    expect(headerCells(render()).map(text)).toEqual([
      "Pull request",
      "Head",
      "Blast radius",
      "Findings",
      "Duration",
      "Cost",
      "When",
    ]);
  });

  it("AC3: right-aligns the Cost header", () => {
    const cost = headerCells(render()).find((cell) => text(cell) === "Cost");
    expect(cost).toBeDefined();
    expect(cost!.match(/class="([^"]*)"/)?.[1]?.split(/\s+/)).toContain("text-right");
  });

  it("AC3: shows each run's own cost in a different row, with no total", () => {
    const body = rows(render());
    const withCost = body.filter((row) => text(row).includes("$"));
    expect(withCost).toHaveLength(2);

    const amounts = withCost.map((row) => text(row).match(/\$[\d.,]+/g));
    expect(amounts).toEqual(expect.arrayContaining([["$0.12"], ["$0.0042"]]));

    const groupHeader = body.find((row) => text(row).includes("PR #42"));
    expect(groupHeader).toBeDefined();
    expect(text(groupHeader!)).not.toContain("$");
  });
});
