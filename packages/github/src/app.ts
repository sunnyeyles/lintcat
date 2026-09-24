import { z } from "zod";

import {
  SEARCH_LIMITS,
  buildMatch,
  formatSearchQuery,
  parseSearchQuery,
} from "#src/search";
import {
  CHECK_RUN_NAME,
  type BlameRange,
  type BlameRequest,
  type BranchTipRequest,
  type ChangedFile,
  type CheckRun,
  type CheckRunAnnotation,
  type CheckRunSummary,
  type CheckRunsRequest,
  type CodeSearchRequest,
  type CodeSearchResult,
  type CommitComparison,
  type CommitFilesRequest,
  type CommitHistoryRequest,
  type CommitMessageRequest,
  type CommitRef,
  type CompareCommitsRequest,
  type CreateCheckRunInput,
  type CreateCommitInput,
  type CreateReviewInput,
  type ExistingReviewComment,
  type FileContentsRequest,
  type PullRequestDetails,
  type PullRequestReadClient,
  type PullRequestRef,
  type PullRequestReview,
  type RepositoryArchive,
  type RepositoryArchiveRequest,
  type RepositoryHistoryClient,
  type ReviewPublishClient,
  type ReviewThread,
  type WriteFileRequest,
} from "#src/client";
import { archiveBytes, readRepositoryTarball } from "#src/archive";
import { blameAuthor, joinCommitRuns } from "#src/blame";
import { httpStatus } from "#src/errors";

/**
 * The slice of Octokit this package consumes. Octokit satisfies it
 * structurally; tests inject a stub so no real network calls happen.
 */
export interface OctokitLike {
  rest: {
    pulls: {
      get(params: {
        owner: string;
        repo: string;
        pull_number: number;
        mediaType?: { format: "diff" };
      }): Promise<{ data: unknown }>;
      listFiles(params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
        page: number;
      }): Promise<{ data: unknown }>;
      listReviewComments(params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
        page: number;
      }): Promise<{ data: unknown }>;
      listCommits(params: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page: number;
        page: number;
      }): Promise<{ data: unknown }>;
      createReview(params: {
        owner: string;
        repo: string;
        pull_number: number;
        commit_id: string;
        body: string;
        event: "COMMENT";
        comments: {
          path: string;
          line: number;
          side: "RIGHT";
          start_line?: number;
          start_side?: "RIGHT";
          body: string;
        }[];
      }): Promise<{ data: unknown }>;
    };
    repos: {
      get(params: { owner: string; repo: string }): Promise<{ data: unknown }>;
      getContent(params: {
        owner: string;
        repo: string;
        path: string;
        ref: string;
      }): Promise<{ data: unknown }>;
      downloadTarballArchive(params: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: unknown }>;
      listCommits(params: {
        owner: string;
        repo: string;
        path: string;
        per_page: number;
      }): Promise<{ data: unknown }>;
      getCommit(params: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: unknown }>;
      compareCommits(params: {
        owner: string;
        repo: string;
        base: string;
        head: string;
      }): Promise<{ data: unknown }>;
      createOrUpdateFileContents(params: {
        owner: string;
        repo: string;
        path: string;
        message: string;
        content: string;
        branch: string;
        sha?: string;
      }): Promise<{ data: unknown }>;
    };
    git: {
      getRef(params: {
        owner: string;
        repo: string;
        ref: string;
      }): Promise<{ data: unknown }>;
      createRef(params: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
      }): Promise<{ data: unknown }>;
      createTree(params: {
        owner: string;
        repo: string;
        base_tree: string;
        tree: {
          path: string;
          mode: "100644";
          type: "blob";
          content: string;
        }[];
      }): Promise<{ data: unknown }>;
      createCommit(params: {
        owner: string;
        repo: string;
        message: string;
        tree: string;
        parents: string[];
      }): Promise<{ data: unknown }>;
      updateRef(params: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
        force: boolean;
      }): Promise<{ data: unknown }>;
    };
    search: {
      code(params: {
        q: string;
        per_page: number;
        mediaType: { format: string };
      }): Promise<{ data: unknown }>;
    };
    checks: {
      listForRef(params: {
        owner: string;
        repo: string;
        ref: string;
        per_page: number;
        page: number;
      }): Promise<{ data: unknown }>;
      create(params: {
        owner: string;
        repo: string;
        name: string;
        head_sha: string;
        status: "completed";
        conclusion: "success" | "failure" | "neutral";
        output: {
          title: string;
          summary: string;
          text?: string;
          annotations?: CheckRunAnnotation[];
        };
      }): Promise<{ data: unknown }>;
    };
  };
  graphql(query: string, variables: Record<string, unknown>): Promise<unknown>;
}

const PAGE_SIZE = 100;

/** The fields of a pulls.get response we map into PullRequestDetails. */
const pullResponseSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  user: z.object({ login: z.string() }).nullable(),
  base: z.object({ ref: z.string(), sha: z.string() }),
  head: z.object({ ref: z.string(), sha: z.string() }),
});

const changedFilesSchema = z.array(
  z.object({
    filename: z.string(),
    status: z.string(),
    previous_filename: z.string().optional(),
    additions: z.number(),
    deletions: z.number(),
    patch: z.string().optional(),
  }),
);

const checkRunResponseSchema = z.object({ id: z.number() });

const reviewResponseSchema = z.object({ id: z.number() });

const reviewCommentsSchema = z.array(z.object({ body: z.string() }));

const REVIEW_THREADS_QUERY = `
  query ReviewThreads($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved
            isOutdated
            comments(first: 1) { nodes { body } }
          }
        }
      }
    }
  }
`;

const reviewThreadsSchema = z.object({
  repository: z.object({
    pullRequest: z.object({
      reviewThreads: z.object({
        pageInfo: z.object({
          hasNextPage: z.boolean(),
          endCursor: z.string().nullable(),
        }),
        nodes: z.array(
          z.object({
            isResolved: z.boolean(),
            isOutdated: z.boolean(),
            comments: z.object({
              nodes: z.array(z.object({ body: z.string() })),
            }),
          }),
        ),
      }),
    }),
  }),
});

const BLAME_QUERY = `
  query Blame($owner: String!, $name: String!, $ref: String!, $path: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $ref) {
        ... on Commit {
          blame(path: $path) {
            ranges {
              startingLine
              endingLine
              commit {
                oid
                committedDate
                author { name email user { login } }
              }
            }
          }
        }
      }
    }
  }
`;

/** `object` is null for a ref GitHub cannot resolve, and has no `blame` unless it is a commit. */
const blameSchema = z.object({
  repository: z.object({
    object: z
      .object({
        blame: z
          .object({
            ranges: z.array(
              z.object({
                startingLine: z.number().int().positive(),
                endingLine: z.number().int().positive(),
                commit: z.object({
                  oid: z.string(),
                  committedDate: z.iso.datetime({ offset: true }),
                  author: z
                    .object({
                      name: z.string().nullable(),
                      email: z.string().nullable(),
                      user: z.object({ login: z.string() }).nullable(),
                    })
                    .nullable(),
                }),
              }),
            ),
          })
          .optional(),
      })
      .nullable(),
  }),
});

/** The `errors` a GraphqlResponseError carries alongside the partial data. */
const graphqlErrorsSchema = z.object({
  errors: z
    .array(
      z.object({
        type: z.string().optional(),
        path: z.array(z.union([z.string(), z.number()])).optional(),
      }),
    )
    .min(1),
});

/** A path the commit lacks may come back as NOT_FOUND on `blame` rather than as no ranges. */
function isMissingBlamePath(error: unknown): boolean {
  const parsed = graphqlErrorsSchema.safeParse(error);
  return (
    parsed.success &&
    parsed.data.errors.every(
      (entry) => entry.type === "NOT_FOUND" && entry.path?.includes("blame") === true,
    )
  );
}

/** The head SHA of a ref; a missing ref is a 404, not an empty response. */
const refSchema = z.object({ object: z.object({ sha: z.string() }) });

const repositorySchema = z.object({ default_branch: z.string() });

/** Only a plain file has a blob SHA to overwrite; a directory does not. */
const existingFileSchema = z.object({ type: z.string(), sha: z.string() });

/** A repos.getContent response for a single (non-directory) entry. */
const fileContentsSchema = z.object({
  type: z.string(),
  encoding: z.string(),
  content: z.string(),
});

/** Only present with the text-match media type; every field is optional upstream. */
const textMatchesSchema = z
  .array(
    z.object({
      property: z.string().optional(),
      fragment: z.string().optional(),
    }),
  )
  .optional();

const commitListSchema = z.array(z.object({ sha: z.string() }));

const objectShaSchema = z.object({ sha: z.string() });

const commitMessageSchema = z.object({
  commit: z.object({ message: z.string() }),
});

/** An empty commit (a merge with no conflicts) carries no files array. */
const commitFilesSchema = z.object({
  files: z.array(z.object({ filename: z.string() })).optional(),
});

const comparisonSchema = z.object({
  status: z.enum(["ahead", "behind", "identical", "diverged"]),
  files: changedFilesSchema.optional(),
});

const checkRunsSchema = z.object({
  check_runs: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
    }),
  ),
});

const codeSearchSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean(),
  items: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      repository: z.object({ full_name: z.string() }),
      text_matches: textMatchesSchema,
    }),
  ),
});

/** Path-property fragments only repeat the path, so they are dropped. */
function contentFragments(
  textMatches: z.infer<typeof textMatchesSchema>,
): string[] {
  return (textMatches ?? [])
    .filter((match) => match.property === undefined || match.property === "content")
    .map((match) => match.fragment)
    .filter((fragment) => fragment !== undefined);
}

/** Walks numbered pages until a short one; GitHub sends no other end marker. */
async function paginate<T>(
  fetchPage: (page: number) => Promise<{ data: unknown }>,
  parsePage: (data: unknown) => T[],
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const pageItems = parsePage((await fetchPage(page)).data);
    items.push(...pageItems);
    if (pageItems.length < PAGE_SIZE) {
      return items;
    }
  }
}

/** The head SHA of one branch, or undefined when GitHub says it has none. */
async function branchSha(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | undefined> {
  try {
    const response = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    return refSchema.parse(response.data).object.sha;
  } catch (error) {
    if (httpStatus(error) === 404) {
      return undefined;
    }
    throw error;
  }
}

/** Branches the default branch's head when `branch` does not exist yet. */
async function ensureBranch(
  octokit: OctokitLike,
  request: WriteFileRequest,
): Promise<void> {
  const { owner, repo, branch } = request;
  if ((await branchSha(octokit, owner, repo, branch)) !== undefined) {
    return;
  }
  const repository = await octokit.rest.repos.get({ owner, repo });
  const defaultBranch = repositorySchema.parse(repository.data).default_branch;
  const sha = await branchSha(octokit, owner, repo, defaultBranch);
  if (sha === undefined) {
    throw new Error(
      `${owner}/${repo} has no ${defaultBranch} branch to branch ${branch} from`,
    );
  }
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha,
  });
}

/** The blob SHA an overwrite must supply; undefined when the file is new. */
async function existingFileSha(
  octokit: OctokitLike,
  request: WriteFileRequest,
): Promise<string | undefined> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner: request.owner,
      repo: request.repo,
      path: request.path,
      ref: request.branch,
    });
    if (Array.isArray(response.data)) {
      throw new Error(`${request.path} is a directory, not a file`);
    }
    const data = existingFileSchema.parse(response.data);
    if (data.type !== "file") {
      throw new Error(`${request.path} is a ${data.type}, not a file`);
    }
    return data.sha;
  } catch (error) {
    if (httpStatus(error) === 404) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Wraps an authenticated Octokit in the read-only PR client, so
 * authentication is the only thing a caller has to supply.
 */
export function createInstallationClient(
  octokit: OctokitLike,
): PullRequestReadClient & RepositoryHistoryClient & ReviewPublishClient {
  return {
    async getPullRequest(ref: PullRequestRef): Promise<PullRequestDetails> {
      const response = await octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullRequestNumber,
      });
      const data = pullResponseSchema.parse(response.data);
      return {
        number: data.number,
        title: data.title,
        body: data.body,
        author: data.user?.login ?? null,
        baseRef: data.base.ref,
        baseSha: data.base.sha,
        headRef: data.head.ref,
        headSha: data.head.sha,
      };
    },

    listChangedFiles(ref: PullRequestRef): Promise<ChangedFile[]> {
      return paginate(
        (page) =>
          octokit.rest.pulls.listFiles({
            owner: ref.owner,
            repo: ref.repo,
            pull_number: ref.pullRequestNumber,
            per_page: PAGE_SIZE,
            page,
          }),
        (data) => changedFilesSchema.parse(data),
      );
    },

    async getDiff(ref: PullRequestRef): Promise<string> {
      const response = await octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullRequestNumber,
        mediaType: { format: "diff" },
      });
      return z.string().parse(response.data);
    },

    async getFileContents(request: FileContentsRequest): Promise<string> {
      const response = await octokit.rest.repos.getContent({
        owner: request.owner,
        repo: request.repo,
        path: request.path,
        ref: request.ref,
      });
      if (Array.isArray(response.data)) {
        throw new Error(`${request.path} is a directory, not a file`);
      }
      const data = fileContentsSchema.parse(response.data);
      if (data.type !== "file") {
        throw new Error(`${request.path} is a ${data.type}, not a file`);
      }
      if (data.encoding !== "base64") {
        throw new Error(
          `${request.path} has unsupported content encoding "${data.encoding}"` +
            " (the file may be too large to fetch)",
        );
      }
      return Buffer.from(data.content, "base64").toString("utf8");
    },

    async getRepositoryArchive(
      request: RepositoryArchiveRequest,
    ): Promise<RepositoryArchive> {
      const response = await octokit.rest.repos.downloadTarballArchive({
        owner: request.owner,
        repo: request.repo,
        ref: request.ref,
      });
      const contents = readRepositoryTarball(
        archiveBytes(response.data),
        request.limits ?? {},
      );
      return { sha: request.ref, ...contents };
    },

    async searchCode(request: CodeSearchRequest): Promise<CodeSearchResult> {
      const repository = `${request.owner}/${request.repo}`;
      const terms = parseSearchQuery(request.query);
      const response = await octokit.rest.search.code({
        q: `${formatSearchQuery(terms)} repo:${repository}`,
        per_page: SEARCH_LIMITS.maxMatches,
        mediaType: { format: "text-match" },
      });
      const data = codeSearchSchema.parse(response.data);
      // The query is already repo-scoped; this filter is belt and braces.
      const matches = data.items
        .filter(
          (item) =>
            item.repository.full_name.toLowerCase() ===
            repository.toLowerCase(),
        )
        .slice(0, SEARCH_LIMITS.maxMatches)
        .map((item) =>
          buildMatch(item.path, terms, {
            snippets: contentFragments(item.text_matches),
          }),
        );
      return {
        matches,
        totalCount: data.total_count,
        incompleteResults: data.incomplete_results,
      };
    },

    async listCommitShas(request: CommitHistoryRequest): Promise<string[]> {
      const response = await octokit.rest.repos.listCommits({
        owner: request.owner,
        repo: request.repo,
        path: request.path,
        per_page: request.limit,
      });
      return commitListSchema
        .parse(response.data)
        .map((commit) => commit.sha);
    },

    async listCommitFiles(request: CommitFilesRequest): Promise<string[]> {
      const response = await octokit.rest.repos.getCommit({
        owner: request.owner,
        repo: request.repo,
        ref: request.sha,
      });
      const data = commitFilesSchema.parse(response.data);
      return (data.files ?? []).map((file) => file.filename);
    },

    async getBranchTip(request: BranchTipRequest): Promise<string> {
      const response = await octokit.rest.git.getRef({
        owner: request.owner,
        repo: request.repo,
        ref: `heads/${request.branch}`,
      });
      return refSchema.parse(response.data).object.sha;
    },

    async getCommitMessage(request: CommitMessageRequest): Promise<string> {
      const response = await octokit.rest.repos.getCommit({
        owner: request.owner,
        repo: request.repo,
        ref: request.sha,
      });
      return commitMessageSchema.parse(response.data).commit.message;
    },

    async blame(request: BlameRequest): Promise<BlameRange[]> {
      let response: unknown;
      try {
        response = await octokit.graphql(BLAME_QUERY, {
          owner: request.owner,
          name: request.repo,
          ref: request.ref,
          path: request.path,
        });
      } catch (error) {
        if (isMissingBlamePath(error)) {
          return [];
        }
        throw error;
      }
      const ranges = blameSchema.parse(response).repository.object?.blame?.ranges ?? [];
      return joinCommitRuns(
        ranges.map(({ startingLine, endingLine, commit }) => ({
          commit: commit.oid,
          startLine: startingLine,
          endLine: endingLine,
          login: commit.author?.user?.login ?? null,
          author: blameAuthor(commit.author?.name, commit.author?.email),
          committedAt: new Date(commit.committedDate).toISOString(),
        })),
      );
    },

    async createCheckRun(input: CreateCheckRunInput): Promise<CheckRun> {
      const output: {
        title: string;
        summary: string;
        text?: string;
        annotations?: CheckRunAnnotation[];
      } = { title: input.output.title, summary: input.output.summary };
      if (input.output.text !== undefined) {
        output.text = input.output.text;
      }
      if (input.output.annotations !== undefined && input.output.annotations.length > 0) {
        output.annotations = input.output.annotations;
      }
      const response = await octokit.rest.checks.create({
        owner: input.owner,
        repo: input.repo,
        name: CHECK_RUN_NAME,
        head_sha: input.headSha,
        status: "completed",
        conclusion: input.conclusion,
        output,
      });
      return checkRunResponseSchema.parse(response.data);
    },

    listPullRequestCommitShas(ref: PullRequestRef): Promise<string[]> {
      return paginate(
        (page) =>
          octokit.rest.pulls.listCommits({
            owner: ref.owner,
            repo: ref.repo,
            pull_number: ref.pullRequestNumber,
            per_page: PAGE_SIZE,
            page,
          }),
        (data) => commitListSchema.parse(data).map((commit) => commit.sha),
      );
    },

    listCheckRuns(request: CheckRunsRequest): Promise<CheckRunSummary[]> {
      // check_runs arrives wrapped in a total_count object.
      return paginate(
        (page) =>
          octokit.rest.checks.listForRef({
            owner: request.owner,
            repo: request.repo,
            ref: request.sha,
            per_page: PAGE_SIZE,
            page,
          }),
        (data) => checkRunsSchema.parse(data).check_runs,
      );
    },

    async compareCommits(
      request: CompareCommitsRequest,
    ): Promise<CommitComparison> {
      const response = await octokit.rest.repos.compareCommits({
        owner: request.owner,
        repo: request.repo,
        base: request.base,
        head: request.head,
      });
      const data = comparisonSchema.parse(response.data);
      return { status: data.status, files: data.files ?? [] };
    },

    listReviewComments(ref: PullRequestRef): Promise<ExistingReviewComment[]> {
      return paginate(
        (page) =>
          octokit.rest.pulls.listReviewComments({
            owner: ref.owner,
            repo: ref.repo,
            pull_number: ref.pullRequestNumber,
            per_page: PAGE_SIZE,
            page,
          }),
        (data) => reviewCommentsSchema.parse(data),
      );
    },

    async listReviewThreads(ref: PullRequestRef): Promise<ReviewThread[]> {
      const threads: ReviewThread[] = [];
      let cursor: string | null = null;
      for (;;) {
        const response: unknown = await octokit.graphql(REVIEW_THREADS_QUERY, {
          owner: ref.owner,
          name: ref.repo,
          number: ref.pullRequestNumber,
          cursor,
        });
        const page =
          reviewThreadsSchema.parse(response).repository.pullRequest
            .reviewThreads;
        for (const node of page.nodes) {
          const body = node.comments.nodes[0]?.body;
          if (body !== undefined) {
            threads.push({
              body,
              isResolved: node.isResolved,
              isOutdated: node.isOutdated,
            });
          }
        }
        if (!page.pageInfo.hasNextPage) {
          return threads;
        }
        cursor = page.pageInfo.endCursor;
      }
    },

    async createReview(input: CreateReviewInput): Promise<PullRequestReview> {
      const response = await octokit.rest.pulls.createReview({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullRequestNumber,
        commit_id: input.commitSha,
        body: input.body,
        event: "COMMENT",
        comments: input.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: "RIGHT" as const,
          // GitHub rejects start_line when it equals line.
          ...(comment.startLine !== undefined && comment.startLine < comment.line
            ? { start_line: comment.startLine, start_side: "RIGHT" as const }
            : {}),
          body: comment.body,
        })),
      });
      return reviewResponseSchema.parse(response.data);
    },

    async createCommitOnBranch(input: CreateCommitInput): Promise<CommitRef> {
      // A commit SHA is a valid base_tree, so the tree needs no extra read.
      const tree = await octokit.rest.git.createTree({
        owner: input.owner,
        repo: input.repo,
        base_tree: input.baseSha,
        tree: input.files.map((file) => ({
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          content: file.content,
        })),
      });
      const commit = await octokit.rest.git.createCommit({
        owner: input.owner,
        repo: input.repo,
        message: input.message,
        tree: objectShaSchema.parse(tree.data).sha,
        parents: [input.baseSha],
      });
      const sha = objectShaSchema.parse(commit.data).sha;
      // Never forced: a branch that moved during the review must lose the race.
      await octokit.rest.git.updateRef({
        owner: input.owner,
        repo: input.repo,
        ref: `heads/${input.branch}`,
        sha,
        force: false,
      });
      return { sha };
    },

    async writeFileOnBranch(request: WriteFileRequest): Promise<void> {
      await ensureBranch(octokit, request);
      const sha = await existingFileSha(octokit, request);
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: request.owner,
        repo: request.repo,
        path: request.path,
        message: request.message,
        content: Buffer.from(request.content, "utf8").toString("base64"),
        branch: request.branch,
        ...(sha === undefined ? {} : { sha }),
      });
    },
  };
}
