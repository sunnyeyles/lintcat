/**
 * Renders validated findings into the check-run payload; the caller owns the
 * API call. Never "failure" (advisory), never "success" when an agent failed.
 */
import type {
  AnnotationLevel,
  CheckRunAnnotation,
  CheckRunConclusion,
  CheckRunOutput,
} from "@pr-review/github";
import type { SkippedAgent } from "@pr-review/ai";
import { categoryLabel, type ReviewFinding } from "@pr-review/schemas";

import {
  countLabel,
  failureNotes,
  pathList,
  skipNotes,
  summarise,
} from "./finding-format.js";
import type { PostedFinding } from "./render-review.js";
import type { AgentFailure } from "./review-pipeline.js";
import { compareFindingStrength } from "./validate-findings.js";

/** The GitHub checks API accepts at most 50 annotations per request. */
export const MAX_ANNOTATIONS_PER_REQUEST = 50;

/** Enough to recognise a pull request; a bump of 300 files would bury the reason. */
const MAX_LISTED_CHANGED_FILES = 10;

export interface RenderedCheckRun {
  conclusion: CheckRunConclusion;
  output: CheckRunOutput;
}

interface RenderCheckRunOptions {
  /** Whether line-anchored findings also become annotations; false once comments carry them. */
  annotate: boolean;
  /** Agents whose paths no changed file matched, named in the summary. */
  skippedAgents?: readonly SkippedAgent[] | undefined;
  /** Earlier commits' findings still open, which a narrowed diff cannot restate. */
  carriedForward?: readonly PostedFinding[] | undefined;
  /** One sentence on what this review read, when it read less than the whole. */
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

/**
 * Names the files nobody reviewed, so the reason a gate held is legible
 * without opening the pull request.
 */
function changedFilesNote(changedFiles: readonly string[]): string[] {
  if (changedFiles.length === 0) {
    return [];
  }
  const listed = pathList(changedFiles.slice(0, MAX_LISTED_CHANGED_FILES));
  const remaining = changedFiles.length - MAX_LISTED_CHANGED_FILES;
  return [
    remaining > 0
      ? `Changed: ${listed}, and ${remaining} more.`
      : `Changed: ${listed}.`,
  ];
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

/**
 * The check run for a pull request no agent's paths matched. Never "success":
 * a green check reads as a clean bill of health.
 */
export function renderNoAgentMatched(
  skippedAgents: readonly SkippedAgent[],
  changedFiles: readonly string[],
  carriedForward: readonly PostedFinding[] = [],
): RenderedCheckRun {
  return {
    conclusion: "neutral",
    output: {
      title: "No agent reviewed this pull request",
      summary: [
        `None of the ${countLabel(skippedAgents.length, "configured agent")} matched the ${countLabel(changedFiles.length, "changed file")}, so this pull request was not reviewed.`,
        ...skippedAgents.map(
          (skipped) =>
            `- ${categoryLabel(skipped.agent)} — waiting on ${pathList(skipped.paths)}`,
        ),
        ...changedFilesNote(changedFiles),
        ...carriedNotes(carriedForward),
      ].join("\n\n"),
    },
  };
}

/** Findings render strongest first; line-anchored ones also become annotations. */
export function renderCheckRun(
  findings: readonly ReviewFinding[],
  agentFailures: readonly AgentFailure[],
  options: RenderCheckRunOptions,
): RenderedCheckRun {
  const skipped = skipNotes(options.skippedAgents ?? []);
  const carried = options.carriedForward ?? [];
  const notes = [
    ...carriedNotes(carried),
    ...failureNotes(agentFailures),
    ...skipped,
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
      conclusion: agentFailures.length === 0 ? "success" : "neutral",
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
