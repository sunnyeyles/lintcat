import { z } from "zod";

import { archiveBytes, readRepositoryTarball } from "#src/archive";
import type {
  ChangedFile,
  CheckRunSummary,
  CheckRunsRequest,
  CodeSearchRequest,
  CodeSearchResult,
  ExistingReviewComment,
  FileContentsRequest,
  PullRequestDetails,
  PullRequestReadClient,
  PullRequestRef,
  RepositoryArchive,
  RepositoryArchiveRequest,
  ReviewThread,
} from "#src/client";
import {
  PAGE_SIZE,
  changedFilesSchema,
  paginate,
  type OctokitLike,
} from "#src/installation-shared";
import {
  SEARCH_LIMITS,
  buildMatch,
  formatSearchQuery,
  parseSearchQuery,
} from "#src/search";

/** The fields of a pulls.get response we map into PullRequestDetails. */
const pullResponseSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  user: z.object({ login: z.string() }).nullable(),
  base: z.object({ ref: z.string(), sha: z.string() }),
  head: z.object({ ref: z.string(), sha: z.string() }),
});

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

export function createInstallationReadClient(
  octokit: OctokitLike,
): PullRequestReadClient {
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
  };
}
