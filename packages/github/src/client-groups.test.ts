/** What the three narrow interfaces partition, and that each stands alone. */
import { describe, expect, it } from "vitest";

import type {
  GithubInstallationClient,
  PullRequestReadClient,
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "#src/client";
import {
  ADAPTER_PROFILES,
  CLIENT_METHODS,
  METHOD_GROUPS,
  type ClientMethod,
} from "#src/conformance";

const SHA = "a".repeat(40);
const REF = { owner: "octo-org", repo: "example-service", pullRequestNumber: 1 };

/** Four methods and nothing else: what the wide interface had no way to say. */
const publisher: ReviewPublishClient = {
  createCheckRun: () => Promise.resolve({ id: 1 }),
  createReview: () => Promise.resolve({ id: 2 }),
  createCommitOnBranch: () => Promise.resolve({ sha: SHA }),
  writeFileOnBranch: () => Promise.resolve(),
};

/** Answers every method with the same stand-in, recording the name reached for. */
function recordingClient(calls: ClientMethod[]): GithubInstallationClient {
  return new Proxy({} as GithubInstallationClient, {
    get: (_target, name: string) => () => {
      calls.push(name as ClientMethod);
      return Promise.resolve({ id: 0 });
    },
  });
}

async function readTitle(reads: PullRequestReadClient): Promise<void> {
  await reads.getPullRequest(REF);
}

async function readTip(history: RepositoryHistoryClient): Promise<void> {
  await history.getBranchTip({ owner: REF.owner, repo: REF.repo, branch: "main" });
}

async function publishResult(publishes: ReviewPublishClient): Promise<number> {
  const run = await publishes.createCheckRun({
    owner: REF.owner,
    repo: REF.repo,
    headSha: SHA,
    conclusion: "neutral",
    output: { title: "t", summary: "s" },
  });
  return run.id;
}

/** Everything an adapter will not do, whether it rejects the call or never declares it. */
const declinedOf = (adapter: keyof typeof ADAPTER_PROFILES): ClientMethod[] => [
  ...(Object.keys(ADAPTER_PROFILES[adapter].unsupported) as ClientMethod[]),
  ...ADAPTER_PROFILES[adapter].absent,
];

describe("client method groups", () => {
  it("assigns every method to exactly one group", () => {
    const grouped = Object.values(METHOD_GROUPS).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...CLIENT_METHODS].sort());
  });

  it("serves all three narrow consumers from one wide client", async () => {
    const calls: ClientMethod[] = [];
    const client = recordingClient(calls);

    await readTitle(client);
    await readTip(client);
    await publishResult(client);

    expect(calls).toEqual(["getPullRequest", "getBranchTip", "createCheckRun"]);
  });

  it("lets a publisher exist without any read method", async () => {
    expect(await publishResult(publisher)).toBe(1);
    expect(Object.keys(publisher)).toEqual(METHOD_GROUPS["review-publish"]);
  });
});

describe("groups against the adapter profiles", () => {
  const adapters = Object.keys(ADAPTER_PROFILES) as (keyof typeof ADAPTER_PROFILES)[];

  it.each(adapters)("%s honours every pull-request read", (adapter) => {
    const reads = new Set<ClientMethod>(METHOD_GROUPS["pull-request-read"]);
    expect(declinedOf(adapter).filter((method) => reads.has(method))).toEqual([]);
  });

  it.each(["local-checkout", "eval-fixture"] as const)(
    "%s declares no publish method at all",
    (adapter) => {
      const absent = new Set<ClientMethod>(ADAPTER_PROFILES[adapter].absent);
      for (const method of METHOD_GROUPS["review-publish"]) {
        expect(absent.has(method), method).toBe(true);
      }
    },
  );
});
