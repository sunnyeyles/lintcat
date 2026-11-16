/** A read-only second opinion on discovery's category; its output is untrusted until validated. */
import { collectRun, type AgentRuntime, type AgentUsage } from "#src/agent/runtime";
import { z } from "zod";

import { categorySchema, type Category, type Spec } from "#src/engine/contract";
import { loadPrompt, renderMessage } from "#src/engine/prompts";

const MAX_FOLLOW_UPS = 5;

const scopingOutputSchema = z.object({
  verdict: z.enum(["accept", "change"]),
  category: categorySchema.optional(),
  reason: z.string(),
  evidence: z.array(z.string()),
  followUps: z.array(z.string()),
});

export type ScopingVerdict =
  | { verdict: "accept"; reason: string; followUps: string[] }
  | { verdict: "change"; category: Category; reason: string; evidence: string[]; followUps: string[] };

const clean = (items: readonly string[]) => items.map((item) => item.trim()).filter(Boolean);

export function validateScoping(raw: unknown, draft: Pick<Spec, "category">): ScopingVerdict {
  const parsed = scopingOutputSchema.safeParse(raw);
  if (!parsed.success) return { verdict: "accept", reason: "", followUps: [] };
  const { verdict, category, reason, evidence, followUps } = parsed.data;
  const kept = clean(followUps).slice(0, MAX_FOLLOW_UPS);
  const cited = clean(evidence);
  if (verdict === "change" && category && category !== draft.category && reason.trim() && cited.length > 0) {
    return { verdict, category, reason: reason.trim(), evidence: cited, followUps: kept };
  }
  return { verdict: "accept", reason: reason.trim(), followUps: kept };
}

export interface ScoperOptions {
  runtime: AgentRuntime;
  repoPath: string;
  spec: Spec;
  signal?: AbortSignal;
}

export interface ScoperResult {
  scoping: ScopingVerdict;
  promptVersion: string;
  usage: AgentUsage[];
}

/** Never blocks discovery: any failure is an accept. */
export async function runScoper({ runtime, repoPath, spec, signal }: ScoperOptions): Promise<ScoperResult> {
  const prompt = loadPrompt("scoper");
  const accept = (usage: AgentUsage[]): ScoperResult => ({
    scoping: { verdict: "accept", reason: "", followUps: [] },
    promptVersion: prompt.version,
    usage,
  });
  try {
    const result = await collectRun(
      runtime.run({
        role: "scoper",
        promptVersion: prompt.version,
        systemPrompt: prompt.text,
        prompt: renderMessage("scoper", "scope", { category: spec.category, spec: JSON.stringify(spec, null, 2) }),
        cwd: repoPath,
        readOnly: true,
        maxTurns: 30,
        outputSchema: z.toJSONSchema(scopingOutputSchema) as Record<string, unknown>,
        ...(signal ? { signal } : {}),
      }),
    );
    if (!result.ok) return accept([result.usage]);
    return { scoping: validateScoping(result.structured, spec), promptVersion: prompt.version, usage: [result.usage] };
  } catch (error) {
    if (signal?.aborted) throw error;
    return accept([]);
  }
}
