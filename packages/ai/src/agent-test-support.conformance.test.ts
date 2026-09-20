/** The structural fake the agent tests run on, held to the same contract. */
import { expect, it } from "vitest";
import {
  AGENT_TOOL_SEARCH_MATCHES,
  runClientConformance,
  type ConformanceCase,
} from "@pr-review/github/conformance";

import { MAX_SEARCH_MATCHES } from "#src/agents/tools";
import { changedFiles, context, headSha, makeGithub } from "#src/agent-test-support";

const SESSIONS_PATH = "src/sessions.ts";

function openCase(): ConformanceCase {
  return {
    client: makeGithub(),
    ref: { owner: context.owner, repo: context.repo, pullRequestNumber: 42 },
    changedFilenames: changedFiles.map((file) => file.filename),
    file: {
      path: SESSIONS_PATH,
      ref: headSha,
      contents: "export const sessions = [];\n",
    },
    missingPath: "src/absent.ts",
    search: {
      unique: "createSession",
      absent: "nothingMatchesThis",
      pathOnly: "sessions.ts",
      flood: { query: "createSession", totalMatches: 1 },
      repeated: { query: "createSession", snippets: 1 },
    },
  };
}

runClientConformance("agent-test-fake", openCase);

it("pins the agent tool's match cap to the one the suite checks adapters against", () => {
  expect(MAX_SEARCH_MATCHES).toBe(AGENT_TOOL_SEARCH_MATCHES);
});
