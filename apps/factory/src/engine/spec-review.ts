/** A fresh reader with no discovery history audits the spec before the person approves it. */
import { collectRun, type AgentRuntime, type AgentUsage } from "#src/agent/runtime";
import { z } from "zod";

import type { Spec } from "#src/engine/contract";
import { routeTask } from "#src/engine/profiles";
import { loadPrompt, renderMessage } from "#src/engine/prompts";

const MAX_FINDINGS = 12;
const SEVERITIES = ["blocker", "major", "nit"] as const;
const LENSES = ["scope", "comprehension", "readiness", "codebase"] as const;

const specReviewOutputSchema = z.object({
  paraphrase: z.object({ proposes: z.string().min(1), existingSystem: z.string().min(1) }),
  findings: z.array(
    z.object({
      severity: z.enum(SEVERITIES),
      lens: z.enum(LENSES),
      field: z.string(),
      problem: z.string().min(1),
      evidence: z.array(z.string()).optional(),
    }),
  ),
});
type SpecFinding = Omit<z.infer<typeof specReviewOutputSchema>["findings"][number], "evidence"> & { evidence: string[]; id: string };

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

/** What the person sees beside the spec: the review, and how discovery answered it. */
export interface SpecAudit {
  review: SpecReview | null;
  resolutions: ResolvedFinding[];
}

// A spec routed `quick` gets only the scope lens: its main risk is being bigger than it looks.
const lensesFor = (spec: Spec): readonly (typeof LENSES)[number][] => (routeTask(spec).profile === "quick" ? ["scope"] : LENSES);

/** Scope findings go straight to the person, so discovery resolves only the rest. */
const resolvable = (review: SpecReview) => review.findings.filter((f) => f.lens !== "scope");

export const needsResolution = (review: SpecReview) => resolvable(review).some((f) => f.severity !== "nit");

export const resolvableList = (review: SpecReview) =>
  resolvable(review)
    .map((f) => `- ${f.id} [${f.severity}, ${f.lens}] ${f.field}: ${f.problem}`)
    .join("\n");

/** Null on a schema miss; drops other lenses and uncited scope findings, then dedupes, sorts, caps, numbers. */
export function validateSpecReview(raw: unknown, promptVersion: string, spec: Spec): SpecReview | null {
  const parsed = specReviewOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const lenses = lensesFor(spec);
  const seen = new Set<string>();
  const kept = parsed.data.findings
    .map((f) => ({ ...f, field: f.field.trim(), evidence: (f.evidence ?? []).map((e) => e.trim()).filter(Boolean) }))
    .filter((f) => lenses.includes(f.lens) && (f.lens !== "scope" || f.evidence.length > 0))
    .filter((f) => {
      const key = `${f.field}\n${f.problem.trim().toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const findings = kept
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
    .slice(0, MAX_FINDINGS)
    .map((f, index) => ({ ...f, id: `F${index + 1}` }));
  return { promptVersion, paraphrase: parsed.data.paraphrase, findings };
}

/** Keeps one resolution per resolvable finding; other ids are dropped. */
export function matchResolutions(review: SpecReview, resolutions: readonly Resolution[]): ResolvedFinding[] {
  const byId = new Map(resolvable(review).map((f) => [f.id, f]));
  const matched = new Map<string, ResolvedFinding>();
  for (const r of resolutions) {
    const finding = byId.get(r.finding.trim());
    if (finding && !matched.has(finding.id)) matched.set(finding.id, { finding, action: r.action, note: r.note });
  }
  return [...matched.values()];
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
      prompt: renderMessage("spec-reviewer", "review", {
        title: options.spec.title,
        spec: JSON.stringify(options.spec, null, 2),
        lenses: lensesFor(options.spec).join(", "),
      }),
      cwd: options.repoPath,
      readOnly: true,
      maxTurns: 40,
      outputSchema: z.toJSONSchema(specReviewOutputSchema) as Record<string, unknown>,
      ...(options.signal ? { signal: options.signal } : {}),
    }),
  );
  return { review: result.ok ? validateSpecReview(result.structured, prompt.version, options.spec) : null, usage: result.usage };
}
