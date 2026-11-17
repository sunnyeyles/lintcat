import { z } from "zod";

import {
  CHECK_RUN_NAME,
  type CheckRun,
  type CheckRunAnnotation,
  type CommitRef,
  type CreateCheckRunInput,
  type CreateCommitInput,
  type CreateReviewInput,
  type PullRequestReview,
  type ReviewPublishClient,
  type WriteFileRequest,
} from "#src/client";
import { httpStatus } from "#src/errors";
import { refSchema, type OctokitLike } from "#src/installation-shared";

const checkRunResponseSchema = z.object({ id: z.number() });

const reviewResponseSchema = z.object({ id: z.number() });

const repositorySchema = z.object({ default_branch: z.string() });

/** Only a plain file has a blob SHA to overwrite; a directory does not. */
const existingFileSchema = z.object({ type: z.string(), sha: z.string() });

const objectShaSchema = z.object({ sha: z.string() });

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

export function createInstallationPublishClient(
  octokit: OctokitLike,
): ReviewPublishClient {
  return {
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
