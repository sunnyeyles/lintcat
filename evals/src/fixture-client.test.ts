/** The fixture GitHub client: what it serves, what it caps, what it refuses. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { SEARCH_LIMITS } from "@pr-review/github";
import type { ChangedFile, PullRequestDetails } from "@pr-review/github";

import type { LoadedFixture } from "#src/fixture";
import { INDEX_ENV, createFixtureClient, indexEnabled } from "#src/fixture-client";

const OWNER = "acme-cloud";
const REPO = "notifications";
const HEAD_SHA = "7d02e6b4915caf83072d16b5e9c4038af62b17de";
const BASE_SHA = "b81f47a2c50d9e3618af75c2d049be31a7c68d05";

const REF = { owner: OWNER, repo: REPO, pullRequestNumber: 154 };

const pullRequest: PullRequestDetails = {
  number: 154,
  title: "Extract the shared page parsing",
  body: "body",
  author: "marta-oliveira",
  baseRef: "main",
  baseSha: BASE_SHA,
  headRef: "refactor/shared-pagination",
  headSha: HEAD_SHA,
};

function makeFixture(
  headFiles: Record<string, string>,
  baseFiles: Record<string, string> = headFiles,
): LoadedFixture {
  const changedFiles: ChangedFile[] = [
    {
      filename: "src/http/pagination.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      patch: "@@ -0,0 +1,1 @@\n+export const page = 1;",
    },
  ];
  return {
    name: "clean-pagination",
    title: "Clean — shared pagination parsing",
    manifest: {
      name: "clean-pagination",
      title: "Clean — shared pagination parsing",
      owner: OWNER,
      repo: REPO,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      pullRequest: {
        number: 154,
        title: pullRequest.title,
        body: "body",
        author: "marta-oliveira",
        baseRef: "main",
        headRef: "refactor/shared-pagination",
      },
      changedFiles: [{ path: "src/http/pagination.ts", status: "added" }],
    },
    pullRequest,
    changedFiles,
    diff: "diff --git a/src/http/pagination.ts b/src/http/pagination.ts",
    context: {
      owner: OWNER,
      repo: REPO,
      pullRequest,
      changedFiles,
      diff: "diff --git a/src/http/pagination.ts b/src/http/pagination.ts",
    },
    headFiles: new Map(Object.entries(headFiles)),
    baseFiles: new Map(Object.entries(baseFiles)),
  };
}

const SIMPLE = {
  "src/http/pagination.ts": "export const page = 1;\n",
  "src/routes/deliveries.ts": "export const deliveries = [];\n",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("indexEnabled", () => {
  it.each([
    ["off", false],
    ["OFF", false],
    ["  off  ", false],
    ["on", true],
    ["", true],
    [undefined, true],
  ])("reads %o as %s", (value, expected) => {
    expect(indexEnabled({ [INDEX_ENV]: value })).toBe(expected);
  });
});

describe("pull request reads", () => {
  it("serves the fixture's pull request, files and diff, recording each read", async () => {
    const { client, calls } = createFixtureClient(makeFixture(SIMPLE));

    await expect(client.getPullRequest(REF)).resolves.toBe(pullRequest);
    await expect(client.getDiff(REF)).resolves.toContain("diff --git");
    await expect(client.listChangedFiles(REF)).resolves.toEqual([
      expect.objectContaining({ filename: "src/http/pagination.ts" }),
    ]);

    expect(calls).toEqual([
      { method: "getPullRequest", detail: "#154" },
      { method: "getDiff", detail: "#154" },
      { method: "listChangedFiles", detail: "#154" },
    ]);
  });

  it("hands out copies of the changed files, so a caller cannot corrupt the fixture", async () => {
    const fixture = makeFixture(SIMPLE);
    const { client } = createFixtureClient(fixture);

    const [file] = await client.listChangedFiles(REF);
    file!.patch = "tampered";

    expect(fixture.changedFiles[0]?.patch).not.toBe("tampered");
  });

  it.each([
    ["owner", { ...REF, owner: "other-org" }],
    ["repo", { ...REF, repo: "other-repo" }],
    ["number", { ...REF, pullRequestNumber: 999 }],
  ])("refuses a pull request whose %s is not the fixture's", async (_label, ref) => {
    const { client, calls } = createFixtureClient(makeFixture(SIMPLE));

    await expect(client.getPullRequest(ref)).rejects.toThrow(
      /fixture clean-pagination serves acme-cloud\/notifications#154/,
    );
    expect(calls).toEqual([]);
  });

  it("reports one commit and no prior review", async () => {
    const { client } = createFixtureClient(makeFixture(SIMPLE));

    await expect(client.listPullRequestCommitShas(REF)).resolves.toEqual([HEAD_SHA]);
    await expect(client.listReviewComments(REF)).resolves.toEqual([]);
    await expect(client.listReviewThreads(REF)).resolves.toEqual([]);
    await expect(
      client.listCheckRuns({ owner: OWNER, repo: REPO, sha: HEAD_SHA }),
    ).resolves.toEqual([]);
    await expect(client.getBranchTip({ owner: OWNER, repo: REPO, branch: "x" })).resolves.toBe(
      HEAD_SHA,
    );
  });
});

describe("getFileContents", () => {
  const fixture = makeFixture(
    { "src/added.ts": "new\n", "src/kept.ts": "head\n" },
    { "src/kept.ts": "base\n" },
  );

  it("reads the head tree at the head SHA", async () => {
    const { client, calls } = createFixtureClient(fixture);

    await expect(
      client.getFileContents({ owner: OWNER, repo: REPO, path: "src/kept.ts", ref: HEAD_SHA }),
    ).resolves.toBe("head\n");
    expect(calls).toEqual([{ method: "getFileContents", detail: "src/kept.ts @ head" }]);
  });

  it("reads the base tree at any other ref", async () => {
    const { client, calls } = createFixtureClient(fixture);

    await expect(
      client.getFileContents({ owner: OWNER, repo: REPO, path: "src/kept.ts", ref: BASE_SHA }),
    ).resolves.toBe("base\n");
    expect(calls).toEqual([{ method: "getFileContents", detail: "src/kept.ts @ base" }]);
  });

  it("reports an added file as absent at the base SHA", async () => {
    const { client } = createFixtureClient(fixture);

    await expect(
      client.getFileContents({ owner: OWNER, repo: REPO, path: "src/added.ts", ref: BASE_SHA }),
    ).rejects.toThrow(`Not Found: src/added.ts does not exist at ${BASE_SHA}`);
  });

  it("refuses a repository that is not the fixture's", async () => {
    const { client } = createFixtureClient(fixture);

    await expect(
      client.getFileContents({ owner: "other", repo: REPO, path: "src/kept.ts", ref: HEAD_SHA }),
    ).rejects.toThrow(/serves acme-cloud\/notifications, not other\/notifications/);
  });
});

describe("searchCode", () => {
  const search = (query: string, files: Record<string, string> = SIMPLE) =>
    createFixtureClient(makeFixture(files)).client.searchCode({
      owner: OWNER,
      repo: REPO,
      query,
    });

  it("requires every term to appear, matching case-insensitively", async () => {
    const result = await search("EXPORT page");

    expect(result.matches.map((match) => match.path)).toEqual(["src/http/pagination.ts"]);
    expect(result.totalCount).toBe(1);
    expect(result.incompleteResults).toBe(false);
  });

  it("matches on the contents alone, never on the path", async () => {
    await expect(search("deliveries.ts")).resolves.toMatchObject({
      matches: [],
      totalCount: 0,
    });

    const result = await search("deliveries");
    expect(result.matches.map((match) => match.path)).toEqual(["src/routes/deliveries.ts"]);
    expect(result.matches[0]?.name).toBe("deliveries.ts");
  });

  it("treats a quoted phrase as a single term", async () => {
    await expect(search('"export const page"')).resolves.toMatchObject({ totalCount: 1 });
    await expect(search('"const export page"')).resolves.toMatchObject({ totalCount: 0 });
  });

  it("returns a window of context around each term, without duplicates", async () => {
    const files = { "src/a.ts": `${"x".repeat(300)}needle${"y".repeat(300)}\n` };
    const [match] = (await search("needle needle", files)).matches;

    expect(match?.snippets).toHaveLength(1);
    expect(match?.snippets[0]).toBe(`${"x".repeat(120)}needle${"y".repeat(120)}`);
  });

  it("caps the matches at the shared limit while still reporting the true total", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 30 }, (_unused, index) => [
        `src/file-${String(index).padStart(2, "0")}.ts`,
        "needle\n",
      ]),
    );

    const result = await search("needle", files);

    expect(result.matches).toHaveLength(SEARCH_LIMITS.maxMatches);
    expect(result.totalCount).toBe(30);
    expect(result.matches[0]?.path).toBe("src/file-00.ts");
    expect(result.matches.at(-1)?.path).toBe("src/file-19.ts");
  });

  it("refuses a repository that is not the fixture's", async () => {
    const { client } = createFixtureClient(makeFixture(SIMPLE));

    await expect(
      client.searchCode({ owner: OWNER, repo: "other", query: "page" }),
    ).rejects.toThrow(/serves acme-cloud\/notifications, not acme-cloud\/other/);
  });
});

describe("getRepositoryArchive", () => {
  const fixture = makeFixture({ "src/a.ts": "head\n" }, { "src/a.ts": "base\n" });
  const request = { owner: OWNER, repo: REPO, ref: BASE_SHA };

  it("serves the base tree, untruncated, at the requested ref", async () => {
    const { client, calls } = createFixtureClient(fixture);

    const archive = await client.getRepositoryArchive(request);

    expect(archive.sha).toBe(BASE_SHA);
    expect([...archive.files]).toEqual([["src/a.ts", "base\n"]]);
    expect(archive.truncated).toBe(false);
    expect(archive.files).not.toBe(fixture.baseFiles);
    expect(calls).toEqual([{ method: "getRepositoryArchive", detail: BASE_SHA }]);
  });

  it("makes the archive unavailable for the control arm", async () => {
    vi.stubEnv(INDEX_ENV, "off");
    const { client, calls } = createFixtureClient(fixture);

    await expect(client.getRepositoryArchive(request)).rejects.toThrow(
      `${INDEX_ENV}=off: the archive of ${OWNER}/${REPO} is unavailable for this run`,
    );
    expect(calls).toHaveLength(1);
  });
});

describe("history the fixture does not have", () => {
  const fixture = makeFixture(SIMPLE);

  it("reports no commits touching a path", async () => {
    const { client, calls } = createFixtureClient(fixture);

    await expect(
      client.listCommitShas({ owner: OWNER, repo: REPO, path: "src/a.ts", limit: 10 }),
    ).resolves.toEqual([]);
    expect(calls).toEqual([{ method: "listCommitShas", detail: "src/a.ts" }]);
  });

  it("declares no read that needs a commit object", () => {
    const { client } = createFixtureClient(fixture);

    for (const method of ["listCommitFiles", "getCommitMessage", "compareCommits"]) {
      expect(method in client, method).toBe(false);
    }
  });
});

describe("writes", () => {
  const fixture = makeFixture(SIMPLE);

  it("declares no publish method, so the harness cannot publish", () => {
    const { client } = createFixtureClient(fixture);

    for (const method of [
      "createCheckRun",
      "createReview",
      "createCommitOnBranch",
      "writeFileOnBranch",
    ]) {
      expect(method in client, method).toBe(false);
    }
  });
});
