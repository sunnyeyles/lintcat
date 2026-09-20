/** The arm switch: which agent set a run evaluates. */
import { GENERAL_AGENT } from "@pr-review/ai";
import { repositoryAgents } from "@pr-review/ai/agent-test-support";
import { describe, expect, it } from "vitest";

import { AGENT_SET_ENV, evalAgentSet } from "#src/agent-set";

const configured = repositoryAgents().map((agent) => agent.category);

describe("evalAgentSet", () => {
  it("runs the configured specialists by default", () => {
    for (const value of [undefined, "", "   ", "specialists"]) {
      expect(evalAgentSet({ [AGENT_SET_ENV]: value }).map((a) => a.category)).toEqual(
        configured,
      );
    }
  });

  it("runs the general agent alone on the control arm", () => {
    for (const value of ["general", " General ", "GENERAL"]) {
      expect(evalAgentSet({ [AGENT_SET_ENV]: value })).toEqual([GENERAL_AGENT]);
    }
  });

  it("keeps the specialists a set of more than one, or the arms measure nothing", () => {
    expect(configured.length).toBeGreaterThan(1);
  });
});
