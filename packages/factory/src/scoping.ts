/** The scoper reads a draft spec cold against the code; its verdict is untrusted until validated here. */
import { collectRun, type AgentRuntime, type AgentUsage } from "@pr-review/agent-runtime";
import { z } from "zod";

import { categorySchema, type Scoping, type Spec } from "#src/contract";
import { loadPrompt, renderMessage } from "#src/prompts";

const MAX_TURNS = 30;
const MAX_FOLLOW_UPS = 5;

const scoperOutputSchema = z.object({
  verdict: z.enum(["accept", "change"]),
  category: categorySchema.optional(),
  reason: z.string(),
  evidence: z.array(z.string()),
  followUps: z.array(z.string()),
});

type ScopingVerdict = Omit<Scoping, "applied" | "promptVersion">;

/** A change needs a different category and evidence, or it is only an accept. */
export function validateScoping(raw: unknown, draft: Spec): ScopingVerdict {
  const parsed = scoperOutputSchema.safeParse(raw);
  const accept = { verdict: "accept" as const, from: draft.category, proposed: draft.category, reason: "", evidence: [], followUps: [] };
  if (!parsed.success) return accept;
  const { verdict, category, reason, evidence, followUps } = parsed.data;
  const cited = evidence.map((e) => e.trim()).filter(Boolean);
  const follow = followUps.map((f) => f.trim()).filter(Boolean).slice(0, MAX_FOLLOW_UPS);
  if (verdict === "change" && category && category !== draft.category && cited.length && reason.trim()) {
    return { verdict, from: draft.category, proposed: category, reason: reason.trim(), evidence: cited, followUps: follow };
  }
  return { ...accept, reason: reason.trim(), followUps: follow };
}

export interface ScoperRun {
  scoping: Omit<Scoping, "applied">;
  usage: AgentUsage;
}

export async function runScoper(input: { runtime: AgentRuntime; repoPath: string; spec: Spec; signal?: AbortSignal }): Promise<ScoperRun> {
  const prompt = loadPrompt("scoper");
  const { scoping: _ignored, ...draft } = input.spec;
  const result = await collectRun(
    input.runtime.run({
      role: "scoper",
      promptVersion: prompt.version,
      systemPrompt: prompt.text,
      prompt: renderMessage("scoper", "scope", { spec: JSON.stringify(draft, null, 2) }),
      cwd: input.repoPath,
      readOnly: true,
      maxTurns: MAX_TURNS,
      outputSchema: z.toJSONSchema(scoperOutputSchema) as Record<string, unknown>,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
  );
  // A failed scoper never blocks discovery: the draft goes to the person unreviewed.
  const verdict = validateScoping(result.ok ? result.structured : null, input.spec);
  return { scoping: { ...verdict, promptVersion: prompt.version }, usage: result.usage };
}
