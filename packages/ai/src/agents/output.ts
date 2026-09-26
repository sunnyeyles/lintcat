/**
 * The Zod-validated contract for an agent's final message. Anything else
 * is an agent failure, never a crash.
 */
import { reviewFindingSchema, type ReviewFinding } from "@pr-review/schemas";
import { z } from "zod";

/** The only output an agent can produce: candidate findings. */
export const agentOutputSchema = z.object({
  findings: z.array(reviewFindingSchema),
});

/** An agent-level failure (bad final output, turn cap, ...). */
export class AgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunError";
  }
}

type AgentOutputResult =
  | { ok: true; findings: ReviewFinding[] }
  | { ok: false; error: string };

/**
 * Everything outside the outermost braces is ignored, but the JSON
 * itself must match agentOutputSchema exactly.
 */
export function extractAgentOutput(text: string): AgentOutputResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { ok: false, error: "final message contains no JSON object" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return {
      ok: false,
      error: `final message JSON does not parse: ${String(error)}`,
    };
  }

  const parsed = agentOutputSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: `final message JSON failed schema validation: ${parsed.error.message}`,
    };
  }

  return { ok: true, findings: parsed.data.findings };
}

/** Cross-category findings are dropped, never re-stamped. */
export function acceptAgentOutput(
  category: string,
  output: AgentOutputResult,
  failure: (error: string) => string,
): ReviewFinding[] {
  if (!output.ok) {
    throw new AgentRunError(failure(output.error));
  }
  return output.findings.filter((finding) => finding.category === category);
}
