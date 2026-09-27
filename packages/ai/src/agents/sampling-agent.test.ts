import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it, vi } from "vitest";

import type { ReviewContext } from "#src/agent-contract";
import {
  context,
  finalFindingsJson,
  makeFinding,
  makeGithub,
} from "#src/agent-test-support";
import { samplingEngine } from "#src/agents/engine";
import { GENERAL_AGENT } from "#src/agents/general-agent";
import type { SampleText, SamplingRequest } from "#src/agents/sampling-agent";

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

function agentOver(sample: SampleText) {
  return samplingEngine({ sample }).createAgent({
    agent: GENERAL_AGENT,
    github: makeGithub(),
    index: undefined,
    logger: createCapturingLogger().logger,
    onUsage: () => {},
  });
}

function review(sample: SampleText, reviewContext: ReviewContext = context) {
  return agentOver(sample).run(reviewContext);
}

describe("the single-shot sampling agent", () => {
  it("returns the findings of one sampling request", async () => {
    const { calls, sample } = sampler(
      finalFindingsJson([makeFinding("general", { title: "Assignment in a condition" })]),
    );

    const findings = await review(sample);

    expect(calls).toHaveLength(1);
    expect(findings).toMatchObject([{ title: "Assignment in a condition" }]);
  });

  it("is named for the agent it runs", () => {
    expect(agentOver(async () => "")).toMatchObject({ name: "general" });
  });

  it("packs the diff, the changed files and the pull request into the one prompt", async () => {
    const { calls, sample } = sampler(finalFindingsJson([]));

    await review(sample);

    const { prompt, systemPrompt } = calls[0]!;
    expect(prompt).toContain("src/sessions.ts (modified, +3 -0)");
    expect(prompt).toContain("if ((user.isAdmin = true))");
    expect(prompt).toContain("Add admin gating to the sessions endpoint");
    expect(systemPrompt).toContain("You have no tools");
    expect(systemPrompt).toContain('Never propose a "patch"');
  });

  it("names no tool in the scope note, having none to call", async () => {
    const { calls, sample } = sampler(finalFindingsJson([]));

    await review(sample, {
      ...context,
      incremental: { sinceSha: "old111", diff: context.diff, changedFiles: context.changedFiles },
    });

    expect(calls[0]?.prompt).toContain('<review_scope since="old111">');
    expect(calls[0]?.prompt).not.toContain("list_changed_files");
  });

  it("fails the agent, not the review, on output that is not the findings JSON", async () => {
    const { sample } = sampler("I had a look and it seems fine to me.");

    await expect(review(sample)).rejects.toThrow(/invalid findings output/);
  });

  it("passes the review's cancellation on to the client", async () => {
    const controller = new AbortController();
    const sample = vi.fn(async () => finalFindingsJson([]));

    await review(sample, { ...context, signal: controller.signal });

    expect(sample).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
