/** A fresh reader with no discovery history audits the spec before the person approves it. */
import { collectRun, type AgentRuntime, type AgentUsage } from "#src/agent/runtime";
import { z } from "zod";

import type { Spec } from "#src/engine/contract";
import { loadPrompt } from "#src/engine/prompts";

const MAX_FINDINGS = 12;
const SEVERITIES = ["blocker", "major", "nit"] as const;

const specReviewOutputSchema = z.object({
  paraphrase: z.object({ proposes: z.string().min(1), existingSystem: z.string().min(1) }),
  findings: z.array(
    z.object({
      severity: z.enum(SEVERITIES),
      lens: z.enum(["comprehension", "readiness", "codebase"]),
      field: z.string(),
      problem: z.string().min(1),
    }),
  ),
});
type SpecFinding = z.infer<typeof specReviewOutputSchema>["findings"][number] & { id: string };

export interface SpecReview {
  promptVersion: string;
  paraphrase: { proposes: string; existingSystem: string };
  findings: SpecFinding[];
}

export const resolutionSchema = z.object({
  finding: z.string(),
  action: z.enum(["fix", "contest", "escalate", "decline"]),
  note: z.string(),
});
export type Resolution = z.infer<typeof resolutionSchema>;
export type ResolvedFinding = { finding: SpecFinding; action: Resolution["action"]; note: string };

/** What the person sees beside the spec: the latest review, and how discovery answered the first. */
export interface SpecAudit {
  review: SpecReview | null;
  resolutions: ResolvedFinding[];
}

export const shouldReviewSpec = (spec: Spec) => spec.category !== "quick";

export const needsResolution = (review: SpecReview) => review.findings.some((f) => f.severity !== "nit");

/** Null when the output fails the schema; otherwise deduped, most severe first, capped, numbered. */
export function validateSpecReview(raw: unknown, promptVersion: string): SpecReview | null {
  const parsed = specReviewOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const seen = new Set<string>();
  const unique = parsed.data.findings.filter((f) => {
    const key = `${f.field.trim()}\n${f.problem.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const findings = unique
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
    .slice(0, MAX_FINDINGS)
    .map((f, index) => ({ ...f, field: f.field.trim(), id: `F${index + 1}` }));
  return { promptVersion, paraphrase: parsed.data.paraphrase, findings };
}

/** Keeps one resolution per known finding; ids the review never issued are dropped. */
export function matchResolutions(review: SpecReview, resolutions: readonly Resolution[]): ResolvedFinding[] {
  const byId = new Map(review.findings.map((f) => [f.id, f]));
  const matched = new Map<string, ResolvedFinding>();
  for (const r of resolutions) {
    const finding = byId.get(r.finding.trim());
    if (finding && !matched.has(finding.id)) matched.set(finding.id, { finding, action: r.action, note: r.note });
  }
  return [...matched.values()];
}

function specReviewPrompt(spec: Spec): string {
  return [
    `# Proposed task: ${spec.title}`,
    "```json",
    JSON.stringify(spec, null, 2),
    "```",
    "Review it once and give your final answer.",
  ].join("\n");
}

export function resolvePrompt(review: SpecReview): string {
  return [
    "A fresh reviewer, who saw only your spec and the repository, reports these findings:",
    ...review.findings.map((f) => `- ${f.id} [${f.severity}, ${f.lens}] ${f.field}: ${f.problem}`),
    `It read the spec as: ${review.paraphrase.proposes}`,
    "Resolve every finding as the system prompt describes, then propose the revised spec with `resolutions`.",
  ].join("\n");
}

export interface ReviewSpecOptions {
  runtime: AgentRuntime;
  repoPath: string;
  spec: Spec;
  signal?: AbortSignal;
}

/** One fresh, read-only session; a failed or malformed review is null, never a blocker. */
export async function reviewSpec(options: ReviewSpecOptions): Promise<{ review: SpecReview | null; usage: AgentUsage }> {
  const prompt = loadPrompt("spec-reviewer");
  const result = await collectRun(
    options.runtime.run({
      role: "spec-reviewer",
      promptVersion: prompt.version,
      systemPrompt: prompt.text,
      prompt: specReviewPrompt(options.spec),
      cwd: options.repoPath,
      readOnly: true,
      maxTurns: 40,
      outputSchema: z.toJSONSchema(specReviewOutputSchema) as Record<string, unknown>,
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );
  return { review: result.ok ? validateSpecReview(result.structured, prompt.version) : null, usage: result.usage };
}
