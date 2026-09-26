/**
 * Renders validated findings into the check-run payload; the caller owns the
 * API call. Never "failure": the review is advisory.
 */
import type {
  AnnotationLevel,
  CheckRunAnnotation,
  CheckRunConclusion,
  CheckRunOutput,
} from "@pr-review/github";
import {
  categoryLabel,
  compareFindingStrength,
  countLabel,
  type ReviewFinding,
} from "@pr-review/schemas";

import type { BlastRadius } from "#src/blast-radius";
import { summarise } from "#src/finding-format";
import type { PostedFinding } from "#src/render-review";
import type { SuggestedReviewer } from "#src/suggest-reviewers";

/** The GitHub checks API accepts at most 50 annotations per request. */
export const MAX_ANNOTATIONS_PER_REQUEST = 50;

export interface RenderedCheckRun {
  conclusion: CheckRunConclusion;
  output: CheckRunOutput;
}

interface RenderCheckRunOptions {
  /** Whether line-anchored findings also become annotations; false once comments carry them. */
  annotate: boolean;
  carriedForward?: readonly PostedFinding[] | undefined;
  scopeNote?: string | undefined;
  /** Leads the summary; absent without an index. */
  blastRadius?: BlastRadius | undefined;
  /** Follows the blast radius; none omits the section. */
  suggestedReviewers?: readonly SuggestedReviewer[] | undefined;
}

const annotationLevelBySeverity: Record<
  ReviewFinding["severity"],
  AnnotationLevel
> = {
  low: "notice",
  medium: "warning",
  high: "failure",
};

function annotate(finding: ReviewFinding, line: number): CheckRunAnnotation {
  const message =
    finding.suggestedFix === undefined
      ? finding.explanation
      : `${finding.explanation}\n\nSuggested fix: ${finding.suggestedFix}`;
  return {
    path: finding.file,
    start_line: line,
    end_line: line,
    annotation_level: annotationLevelBySeverity[finding.severity],
    message,
    title: finding.title,
  };
}

// Listed so a narrowed review cannot read as a clean one.
function carriedNotes(carried: readonly PostedFinding[]): string[] {
  if (carried.length === 0) {
    return [];
  }
  return [
    `**${countLabel(carried.length, "finding")} still open from earlier commits**`,
    ...carried.map((posted) => {
      const heading =
        posted.heading ?? `${categoryLabel(posted.category)}: ${posted.title}`;
      return `- ${heading} — \`${posted.file}\``;
    }),
  ];
}

const bandLabel = { low: "Low", medium: "Medium", high: "High" } as const;

function reach({ counts, packages }: BlastRadius["impact"]): string {
  if (counts.transitive === 0) {
    return "no indexed files depend on this change";
  }
  const where =
    packages.length === 0
      ? ""
      : ` in ${countLabel(packages.length, "package")}`;
  const verb = counts.transitive === 1 ? "depends" : "depend";
  return `${countLabel(counts.transitive, "file")}${where} ${verb} on this change`;
}

function renderBlastRadius({ impact, risk }: BlastRadius): string {
  const lines = [
    `**Blast radius: ${bandLabel[risk.band]} (${risk.score})** · ${reach(impact)}`,
  ];
  if (impact.hubs.length > 0) {
    lines.push(
      "",
      "Most depended-on changed files:",
      "",
      ...impact.hubs.map(
        (hub) =>
          `- \`${hub.path}\` — ${countLabel(hub.dependents, "dependent")}`,
      ),
    );
  }
  if (risk.factors.length > 0) {
    lines.push(
      "",
      "<details><summary>How the score adds up</summary>",
      "",
      ...risk.factors.map((factor) => `- ${factor.label} (+${factor.points})`),
      "",
      "</details>",
    );
  }
  const footnote = risk.partial
    ? "Static imports only. Partial: archive truncated or unindexed language."
    : "Static imports only.";
  lines.push("", `<sub>${footnote}</sub>`);
  return lines.join("\n");
}

function reviewerLabel(reviewer: SuggestedReviewer, first: boolean): string {
  if (reviewer.source === "codeowners") {
    return "CODEOWNERS";
  }
  const percent = reviewer.percent === 0 ? "<1%" : `${reviewer.percent}%`;
  return first ? `${percent} of changed lines` : percent;
}

function renderSuggestedReviewers(
  reviewers: readonly SuggestedReviewer[],
): string {
  const named = reviewers.map(
    (reviewer, at) => `@${reviewer.handle} (${reviewerLabel(reviewer, at === 0)})`,
  );
  return `**Suggested reviewers:** ${named.join(" · ")}`;
}

/** Findings render strongest first; line-anchored ones also become annotations. */
export function renderCheckRun(
  findings: readonly ReviewFinding[],
  options: RenderCheckRunOptions,
): RenderedCheckRun {
  const carried = options.carriedForward ?? [];
  const reviewers = options.suggestedReviewers ?? [];
  const lead = [
    ...(options.blastRadius === undefined
      ? []
      : [renderBlastRadius(options.blastRadius)]),
    ...(reviewers.length === 0 ? [] : [renderSuggestedReviewers(reviewers)]),
  ];
  const notes = [
    ...carriedNotes(carried),
    ...(options.scopeNote === undefined ? [] : [options.scopeNote]),
  ];
  if (findings.length === 0 && carried.length > 0) {
    return {
      conclusion: "neutral",
      output: {
        title: `${countLabel(carried.length, "finding")} open from earlier commits`,
        summary: [
          ...lead,
          "This review added no findings; these stand from earlier commits.",
          ...notes,
        ].join("\n\n"),
      },
    };
  }
  if (findings.length === 0) {
    return {
      conclusion: "success",
      output: {
        title: "No issues found",
        summary: [
          ...lead,
          "The AI review found no issues in this pull request.",
          ...notes,
        ].join("\n\n"),
      },
    };
  }

  const ordered = [...findings].sort(compareFindingStrength);
  const title = countLabel(findings.length, "finding");
  const summary = [
    ...lead,
    `**${title}**`,
    "",
    ...ordered.map(summarise),
    ...notes,
  ].join("\n\n");

  const output: CheckRunOutput = { title, summary };

  if (options.annotate) {
    const annotations: CheckRunAnnotation[] = [];
    for (const finding of ordered) {
      if (annotations.length >= MAX_ANNOTATIONS_PER_REQUEST) {
        break;
      }
      if (finding.line !== undefined) {
        annotations.push(annotate(finding, finding.line));
      }
    }
    if (annotations.length > 0) {
      output.annotations = annotations;
    }
  }

  return { conclusion: "neutral", output };
}
