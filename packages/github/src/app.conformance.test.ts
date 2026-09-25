/** The Octokit adapter against a stub that answers the way GitHub does. */
import { runClientConformance, type ConformanceCase } from "#src/conformance";
import { createInstallationClient, type OctokitLike } from "#src/app";

const OWNER = "octo-org";
const REPO = "example-service";
const HEAD_SHA = "6dcb09b5b57875f334f61aebed695e2e4193db5e";

const UNIQUE_PATH = "src/unique.ts";
const UNIQUE_CONTENTS = "export const uniqueToken = 1;\n";
const REPEATED_PATH = "src/repeated.ts";
const FLOOD_FILES = 25;

/** Wider than the snippet padding, so each hit earns its own window. */
const PADDING = "-".repeat(300);

const REPEATED_CONTENTS = Array.from(
  { length: 5 },
  (_, i) => `export const repeatedToken${i} = ${i}; //${PADDING}\n`,
).join("");

const FILES = new Map<string, string>([
  [UNIQUE_PATH, UNIQUE_CONTENTS],
  [REPEATED_PATH, REPEATED_CONTENTS],
  ...Array.from({ length: FLOOD_FILES }, (_, i) => {
    const index = String(i).padStart(2, "0");
    return [`src/flood-${index}.ts`, `export const floodToken = ${i};\n`] as const;
  }),
]);

const CHANGED = [
  { filename: UNIQUE_PATH, status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@" },
  { filename: REPEATED_PATH, status: "added", additions: 5, deletions: 0 },
];

/** GitHub's own error: a 404 carries the name Octokit's RequestError sets. */
function notFound(message: string): Error {
  const error = new Error(message);
  error.name = "HttpError";
  return Object.assign(error, { status: 404 });
}

function unused(name: string) {
  return () => Promise.reject(new Error(`${name} is not exercised by the conformance suite`));
}

function searchTerms(q: string): string[] {
  return q
    .split(/\s+/)
    .filter((term) => term !== "" && !term.startsWith("repo:"))
    .map((term) => term.toLowerCase());
}

function fragments(contents: string, terms: readonly string[]): { fragment: string }[] {
  return contents
    .split("\n")
    .filter((line) => terms.every((term) => line.toLowerCase().includes(term)))
    .map((fragment) => ({ fragment }));
}

/** Each file is one commit's work; an unknown path gets empty ranges, not a NOT_FOUND error. */
function blameResponse(path: unknown) {
  const contents = FILES.get(String(path));
  const lines = contents === undefined ? 0 : contents.split("\n").length - 1;
  const commit = {
    oid: HEAD_SHA,
    committedDate: "2026-09-01T10:00:00Z",
    author: { name: "The Octocat", email: "octocat@github.com", user: { login: "octocat" } },
  };
  return {
    repository: {
      object: {
        blame: {
          ranges: lines === 0 ? [] : [{ startingLine: 1, endingLine: lines, commit }],
        },
      },
    },
  };
}

function stubOctokit(): OctokitLike {
  return {
    rest: {
      pulls: {
        get: (params) =>
          Promise.resolve({
            data:
              params.mediaType?.format === "diff"
                ? "diff --git a/src/unique.ts b/src/unique.ts\n"
                : {
                    number: params.pull_number,
                    title: "Extract the unique token",
                    body: null,
                    user: { login: "octocat" },
                    base: { ref: "main", sha: "0".repeat(40) },
                    head: { ref: "feature/unique", sha: HEAD_SHA },
                  },
          }),
        listFiles: (params) => Promise.resolve({ data: params.page === 1 ? CHANGED : [] }),
        listReviewComments: () => Promise.resolve({ data: [] }),
        listCommits: () => Promise.resolve({ data: [] }),
        createReview: unused("createReview"),
      },
      repos: {
        get: () => Promise.resolve({ data: { default_branch: "main" } }),
        getContent: (params) => {
          const contents = FILES.get(params.path);
          if (contents === undefined) {
            return Promise.reject(notFound(`Not Found: ${params.path}`));
          }
          return Promise.resolve({
            data: {
              type: "file",
              encoding: "base64",
              content: Buffer.from(contents, "utf8").toString("base64"),
            },
          });
        },
        downloadTarballArchive: unused("downloadTarballArchive"),
        listCommits: () => Promise.resolve({ data: [] }),
        getCommit: () => Promise.resolve({ data: { commit: { message: "m" }, files: [] } }),
        compareCommits: () =>
          Promise.resolve({ data: { status: "ahead", files: [] } }),
        createOrUpdateFileContents: unused("createOrUpdateFileContents"),
      },
      git: {
        getRef: () => Promise.resolve({ data: { object: { sha: HEAD_SHA } } }),
        createRef: unused("createRef"),
        createTree: unused("createTree"),
        createCommit: unused("createCommit"),
        updateRef: unused("updateRef"),
      },
      search: {
        // GitHub honours per_page, so the adapter's cap is a request, not a slice.
        code: (params) => {
          const terms = searchTerms(params.q);
          const hits = [...FILES]
            .filter(([, contents]) =>
              terms.every((term) => contents.toLowerCase().includes(term)),
            )
            .sort(([a], [b]) => a.localeCompare(b));
          return Promise.resolve({
            data: {
              total_count: hits.length,
              incomplete_results: false,
              items: hits.slice(0, params.per_page).map(([path, contents]) => ({
                name: path.slice(path.lastIndexOf("/") + 1),
                path,
                repository: { full_name: `${OWNER}/${REPO}` },
                text_matches: fragments(contents, terms),
              })),
            },
          });
        },
      },
      checks: {
        listForRef: () => Promise.resolve({ data: { check_runs: [] } }),
        create: unused("checks.create"),
      },
    },
    graphql: (query, variables) =>
      query.includes("blame(")
        ? Promise.resolve(blameResponse(variables["path"]))
        : unused("graphql")(),
  };
}

function openCase(): ConformanceCase {
  return {
    client: createInstallationClient(stubOctokit()),
    ref: { owner: OWNER, repo: REPO, pullRequestNumber: 42 },
    changedFilenames: CHANGED.map((file) => file.filename),
    file: { path: UNIQUE_PATH, ref: HEAD_SHA, contents: UNIQUE_CONTENTS },
    missingPath: "src/absent.ts",
    search: {
      unique: "uniqueToken",
      absent: "nothingMatchesThis",
      pathOnly: "flood-00",
      flood: { query: "floodToken", totalMatches: FLOOD_FILES },
      repeated: { query: "repeatedToken", snippets: 2 },
    },
  };
}

runClientConformance("octokit", openCase);
