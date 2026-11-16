/** The one independent review: its output is untrusted until validated against the real diff. */
import { z } from "zod";

import type { TaskContract } from "#src/engine/contract";
import { renderMessage } from "#src/engine/prompts";

const MAX_FINDINGS = 20;
const MAX_DIFF_CHARS = 80_000;

export const reviewOutputSchema = z.object({
  verdict: z.enum(["approve", "changes"]),
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: z.enum(["blocking", "minor"]),
      file: z.string(),
      line: z.number().int().positive().optional(),
      acceptanceId: z.string().optional(),
      problem: z.string().min(1),
    }),
  ),
});
type ReviewOutput = z.infer<typeof reviewOutputSchema>;
type Finding = ReviewOutput["findings"][number];

export interface ValidatedReview {
  verdict: "approve" | "changes";
  summary: string;
  findings: Finding[];
  dropped: { finding: unknown; reason: string }[];
  blocking: Finding[];
}

/** Null when the output fails the schema; otherwise keeps only findings on changed files. */
export function validateReview(raw: unknown, changed: readonly string[], contract: TaskContract): ValidatedReview | null {
  const parsed = reviewOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const files = new Set(changed);
  const acceptanceIds = new Set(contract.spec.acceptanceCriteria.map((ac) => ac.id));
  const findings: Finding[] = [];
  const dropped: ValidatedReview["dropped"] = [];
  for (const finding of parsed.data.findings) {
    const file = finding.file.replace(/^\.?\/+/, "").replace(/^workspace\//, "");
    if (!files.has(file)) {
      dropped.push({ finding, reason: "file is not in the diff" });
      continue;
    }
    if (findings.length >= MAX_FINDINGS) {
      dropped.push({ finding, reason: `over the cap of ${MAX_FINDINGS}` });
      continue;
    }
    const { acceptanceId, ...rest } = finding;
    findings.push({ ...rest, file, ...(acceptanceId && acceptanceIds.has(acceptanceId) ? { acceptanceId } : {}) });
  }
  const blocking = findings.filter((f) => f.severity === "blocking");
  return { verdict: blocking.length > 0 ? "changes" : "approve", summary: parsed.data.summary, findings, dropped, blocking };
}

export function reviewPrompt(contract: TaskContract, changed: readonly string[], diff: string): string {
  const { spec } = contract;
  const frozen = { requirements: spec.requirements, acceptanceCriteria: spec.acceptanceCriteria, nonGoals: spec.nonGoals, constraints: spec.constraints, architectureDecisions: spec.architectureDecisions };
  const shown = diff.length > MAX_DIFF_CHARS ? renderMessage("reviewer", "diff-truncated", { diff: diff.slice(0, MAX_DIFF_CHARS) }) : diff;
  return renderMessage("reviewer", "review", {
    title: spec.title,
    objective: spec.objective,
    spec: JSON.stringify(frozen, null, 2),
    changed: changed.map((f) => `- ${f}`).join("\n"),
    base: contract.baseSha.slice(0, 12),
    diff: shown,
  });
}

export function reviewRepairPrompt(blocking: readonly Finding[]): string {
  const findings = blocking.map((f) => `- ${f.file}${f.line ? `:${f.line}` : ""}${f.acceptanceId ? ` (${f.acceptanceId})` : ""}: ${f.problem}`);
  return renderMessage("implementer", "review-repair", { findings: findings.join("\n") });
}

export function renderReview(review: ValidatedReview): string[] {
  return [
    `Verdict: **${review.verdict}**. ${review.summary}`,
    ...review.findings.map((f) => `- ${f.severity}: \`${f.file}${f.line ? `:${f.line}` : ""}\`${f.acceptanceId ? ` (${f.acceptanceId})` : ""} ${f.problem}`),
    ...(review.dropped.length ? [`- ${review.dropped.length} finding(s) dropped by validation`] : []),
  ];
}
