import { z } from "zod";

import { blameAuthor, joinCommitRuns } from "#src/blame";
import type {
  BlameRange,
  BlameRequest,
  BranchTipRequest,
  CommitComparison,
  CommitFilesRequest,
  CommitHistoryRequest,
  CommitMessageRequest,
  CompareCommitsRequest,
  PullRequestRef,
  RepositoryHistoryClient,
} from "#src/client";
import {
  PAGE_SIZE,
  changedFilesSchema,
  paginate,
  refSchema,
  type OctokitLike,
} from "#src/installation-shared";

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

const commitListSchema = z.array(z.object({ sha: z.string() }));

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

export function createInstallationHistoryClient(
  octokit: OctokitLike,
): RepositoryHistoryClient {
  return {
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
  };
}
