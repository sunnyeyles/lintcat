/** What every review engine must do with the request it is handed, held against both adapters. */
import { buildRepositoryIndex } from "@pr-review/index";
import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it } from "vitest";

import type { ReviewContext } from "#src/agent-contract";
import {
  archiveFiles,
  baseSha,
  context,
  finalFindingsJson,
  makeFinding,
  makeGithub,
  makeModel,
  message,
  textBlock,
} from "#src/agent-test-support";
import {
  samplingEngine,
  toolLoopEngine,
  type AgentRequest,
  type ReviewEngine,
} from "#src/agents/engine";
import { GENERAL_AGENT } from "#src/agents/general-agent";
import type { AgentUsageReport } from "#src/agents/runtime";
import type { SamplingRequest } from "#src/agents/sampling-agent";

interface Sent {
  system: string;
  opening: string;
}

/** An engine whose model answers `reply` once, or rejects when `reply` is null. */
interface EngineHarness {
  engine: ReviewEngine;
  sent(): Sent;
}

type MakeHarness = (reply: string | null) => EngineHarness;

type Prompt = { role?: string; content?: string | { type: string; text?: string }[] };

function textOf(entry: Prompt | undefined): string {
  const { content } = entry ?? {};
  if (typeof content === "string") {
    return content;
  }
  return (content ?? []).map((part) => part.text ?? "").join("");
}

const toolLoop: MakeHarness = (reply) => {
  const { model, calls } = makeModel(
    reply === null
      ? []
      : [message([textBlock(reply)], "end_turn", { inputTokens: 40, outputTokens: 9 })],
  );
  return {
    engine: toolLoopEngine({ model }),
    sent: () => {
      const prompt = (calls[0]?.prompt ?? []) as Prompt[];
      return {
        system: textOf(prompt.find((entry) => entry.role === "system")),
        opening: textOf(prompt.find((entry) => entry.role === "user")),
      };
    },
  };
};

const sampling: MakeHarness = (reply) => {
  const requests: SamplingRequest[] = [];
  return {
    engine: samplingEngine({
      sample: async (request) => {
        requests.push(request);
        if (reply === null) {
          throw new Error("the client refused the sampling request");
        }
        return reply;
      },
    }),
    sent: () => ({
      system: requests[0]?.systemPrompt ?? "",
      opening: requests[0]?.prompt ?? "",
    }),
  };
};

const incremental: ReviewContext = {
  ...context,
  diff: "@@ -2 +2 @@\n+const limit = 0;\n",
  changedFiles: [
    {
      filename: "src/limits.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: "@@ -2 +2 @@\n+const limit = 0;",
    },
  ],
  incremental: {
    sinceSha: "old111",
    diff: context.diff,
    changedFiles: context.changedFiles,
  },
};

function runEngineConformance(name: string, make: MakeHarness): void {
  describe(`review engine conformance: ${name}`, () => {
    async function review(
      reviewContext: ReviewContext,
      overrides: Partial<AgentRequest> = {},
      reply: string | null = finalFindingsJson([]),
    ) {
      const harness = make(reply);
      const reports: AgentUsageReport[] = [];
      const agent = harness.engine.createAgent({
        agent: GENERAL_AGENT,
        github: makeGithub(),
        index: undefined,
        logger: createCapturingLogger().logger,
        onUsage: (report) => reports.push(report),
        ...overrides,
      });
      const outcome = await agent.run(reviewContext).then(
        (findings) => ({ findings }),
        (error: unknown) => ({ error }),
      );
      return { ...harness.sent(), reports, outcome };
    }

    it("notes the narrowed scope of an incremental review, and sends only its diff", async () => {
      const { opening } = await review(incremental);

      expect(opening).toContain('<review_scope since="old111">');
      expect(opening).toContain("+const limit = 0;");
      expect(opening).not.toContain("user.isAdmin = true");
    });

    it("says nothing about scope when the whole pull request is under review", async () => {
      const { opening } = await review(context);

      expect(opening).not.toContain("<review_scope");
    });

    it("renders what the repository index knows about the changed files", async () => {
      const index = buildRepositoryIndex({ sha: baseSha, files: archiveFiles });

      const { opening } = await review(context, { index });

      expect(opening).toContain(`<repository_index sha="${baseSha}"`);
      expect(opening).toContain("- src/sessions.ts — ");
    });

    it("carries the base commit's rule docs and lint config ahead of the diff", async () => {
      const files = new Map(archiveFiles);
      files.set("AGENTS.md", "- Sessions are created only in src/sessions.ts.\n");
      files.set(".prettierrc.json", '{ "semi": true }\n');
      const index = buildRepositoryIndex({ sha: baseSha, files });

      const { opening } = await review(context, { index });

      expect(opening).toContain(
        '<rule_doc path="AGENTS.md">\n1| - Sessions are created only in src/sessions.ts.\n</rule_doc>',
      );
      expect(opening).toContain('- Prettier (.prettierrc.json):\n    { "semi": true }');
      expect(opening.indexOf("</rule_docs>")).toBeLessThan(opening.indexOf("<lint_config>"));
      expect(opening.indexOf("</lint_config>")).toBeLessThan(opening.indexOf("<diff>"));
    });

    it("reports the run's token usage once", async () => {
      const { reports } = await review(context);

      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ agent: "general", steps: 1 });
      expect(reports[0]?.usage.inputTokens).toBeGreaterThan(0);
      expect(reports[0]?.usage.outputTokens).toBeGreaterThan(0);
    });

    it("reports usage when the model call fails too", async () => {
      const { reports, outcome } = await review(context, {}, null);

      expect(outcome).toHaveProperty("error");
      expect(reports).toHaveLength(1);
    });

    it("returns the findings in the agent's own category", async () => {
      const { outcome } = await review(
        context,
        {},
        finalFindingsJson([makeFinding("naming"), makeFinding("security")]),
      );

      expect(outcome).toMatchObject({ findings: [{ category: "naming" }] });
    });
  });
}

runEngineConformance("tool loop", toolLoop);
runEngineConformance("sampling", sampling);
