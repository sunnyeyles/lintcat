import { describe, expect, it, vi } from "vitest";

import {
  context,
  finalFindingsJson,
  makeFinding,
} from "#src/agent-test-support";
import { createSamplingAgent, type SamplingRequest } from "#src/agents/sampling-agent";

function sampler(text: string) {
  const calls: SamplingRequest[] = [];
  return {
    calls,
    sample: async (request: SamplingRequest) => {
      calls.push(request);
      return text;
    },
  };
}

describe("the single-shot sampling agent", () => {
  it("returns the findings of one sampling request", async () => {
    const { calls, sample } = sampler(
      finalFindingsJson([makeFinding("general", { title: "Assignment in a condition" })]),
    );
    const agent = createSamplingAgent({ sample });

    const findings = await agent.run(context);

    expect(calls).toHaveLength(1);
    expect(findings).toMatchObject([{ title: "Assignment in a condition" }]);
  });

  it("is the general agent", () => {
    expect(createSamplingAgent({ sample: async () => "" })).toMatchObject({
      name: "general",
    });
  });

  it("packs the diff, the changed files and the pull request into the one prompt", async () => {
    const { calls, sample } = sampler(finalFindingsJson([]));

    await createSamplingAgent({ sample }).run(context);

    const { prompt, systemPrompt } = calls[0]!;
    expect(prompt).toContain("src/sessions.ts (modified, +3 -0)");
    expect(prompt).toContain("if ((user.isAdmin = true))");
    expect(prompt).toContain("Add admin gating to the sessions endpoint");
    expect(systemPrompt).toContain("You have no tools");
    expect(systemPrompt).toContain('Never propose a "patch"');
  });

  it("drops findings in a category it does not own", async () => {
    const { sample } = sampler(
      finalFindingsJson([makeFinding("general"), makeFinding("security")]),
    );

    const findings = await createSamplingAgent({ sample }).run(context);

    expect(findings).toMatchObject([{ category: "general" }]);
  });

  it("fails the agent, not the review, on output that is not the findings JSON", async () => {
    const { sample } = sampler("I had a look and it seems fine to me.");

    await expect(createSamplingAgent({ sample }).run(context)).rejects.toThrow(
      /invalid findings output/,
    );
  });

  it("passes the review's cancellation on to the client", async () => {
    const controller = new AbortController();
    const sample = vi.fn(async () => finalFindingsJson([]));

    await createSamplingAgent({ sample }).run({ ...context, signal: controller.signal });

    expect(sample).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
