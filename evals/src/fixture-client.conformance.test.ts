/** The eval fixture adapter against a planted in-memory repository. */
import type { ChangedFile, PullRequestDetails } from "@pr-review/github";
import { runClientConformance, type ConformanceCase } from "@pr-review/github/conformance";

import { createFixtureClient } from "#src/fixture-client";
import type { LoadedFixture } from "#src/fixture";

const OWNER = "acme-cloud";
const REPO = "notifications";
const HEAD_SHA = "7d02e6b4915caf83072d16b5e9c4038af62b17de";
const BASE_SHA = "b81f47a2c50d9e3618af75c2d049be31a7c68d05";

const UNIQUE_PATH = "src/unique.ts";
const UNIQUE_CONTENTS = "export const uniqueToken = 1;\n";
const CHANGED_PATH = "src/api.ts";
const FLOOD_FILES = 30;

const HEAD_FILES = new Map<string, string>([
  [UNIQUE_PATH, UNIQUE_CONTENTS],
  [
    "src/repeated.ts",
    Array.from({ length: 5 }, (_, i) => `export const repeatedToken${i} = ${i};\n`).join(""),
  ],
  [CHANGED_PATH, "export const api = 2;\n"],
  ...Array.from({ length: FLOOD_FILES }, (_, i) => {
    const index = String(i).padStart(2, "0");
    return [`src/flood-${index}.ts`, `export const floodToken = ${i};\n`] as const;
  }),
]);

const pullRequest: PullRequestDetails = {
  number: 154,
  title: "Extract the unique token",
  body: "body",
  author: "marta-oliveira",
  baseRef: "main",
  baseSha: BASE_SHA,
  headRef: "refactor/unique-token",
  headSha: HEAD_SHA,
};

const changedFiles: ChangedFile[] = [
  {
    filename: CHANGED_PATH,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: "@@ -1 +1 @@\n-export const api = 1;\n+export const api = 2;",
  },
];

const diff = `diff --git a/${CHANGED_PATH} b/${CHANGED_PATH}`;

const fixture: LoadedFixture = {
  name: "conformance",
  title: "Conformance — a planted repository",
  manifest: {
    name: "conformance",
    title: "Conformance — a planted repository",
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
      headRef: "refactor/unique-token",
    },
    changedFiles: [{ path: CHANGED_PATH, status: "modified" }],
  },
  pullRequest,
  changedFiles,
  diff,
  context: { owner: OWNER, repo: REPO, pullRequest, changedFiles, diff },
  headFiles: HEAD_FILES,
  baseFiles: new Map([...HEAD_FILES, [CHANGED_PATH, "export const api = 1;\n"]]),
};

function openCase(): ConformanceCase {
  return {
    client: createFixtureClient(fixture).client,
    ref: { owner: OWNER, repo: REPO, pullRequestNumber: 154 },
    changedFilenames: [CHANGED_PATH],
    file: { path: UNIQUE_PATH, ref: HEAD_SHA, contents: UNIQUE_CONTENTS },
    missingPath: "src/absent.ts",
    search: {
      unique: "uniqueToken",
      absent: "nothingMatchesThis",
      flood: { query: "floodToken", totalMatches: FLOOD_FILES },
      repeated: { query: "repeatedToken", snippets: 1 },
    },
  };
}

runClientConformance("eval-fixture", openCase);
