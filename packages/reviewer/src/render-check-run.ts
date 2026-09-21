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
import { categoryLabel, type ReviewFinding } from "@pr-review/schemas";

import { countLabel, summarise } from "#src/finding-format";
import type { PostedFinding } from "#src/render-review";
import { compareFindingStrength } from "#src/validate-findings";

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

/** Findings render strongest first; line-anchored ones also become annotations. */
export function renderCheckRun(
  findings: readonly ReviewFinding[],
  options: RenderCheckRunOptions,
): RenderedCheckRun {
  const carried = options.carriedForward ?? [];
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
          "The AI review found no issues in this pull request.",
          ...notes,
        ].join("\n\n"),
      },
    };
  }

  const ordered = [...findings].sort(compareFindingStrength);
  const title = countLabel(findings.length, "finding");
  const summary = [
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
