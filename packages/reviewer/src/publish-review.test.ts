import type {
  CreateCheckRunInput,
  CreateCommitInput,
  CreateReviewInput,
  ReviewPublishClient,
  WriteFileRequest,
} from "@pr-review/github";
import { describe, expect, it, vi } from "vitest";

import { createCheckRunPublisher } from "#src/publish-review";
import type { RenderedCheckRun } from "#src/render-check-run";
import type { ReviewTarget } from "#src/review-target";

const target: ReviewTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
};

function makeClient() {
  return {
    createCheckRun: vi.fn(async (_input: CreateCheckRunInput) => ({ id: 987 })),
    createReview: vi.fn(async (_input: CreateReviewInput) => ({ id: 654 })),
    createCommitOnBranch: vi.fn(async (_input: CreateCommitInput) => ({
      sha: "fix1234",
    })),
    writeFileOnBranch: vi.fn(async (_request: WriteFileRequest) => {}),
  } satisfies ReviewPublishClient;
}

describe("createCheckRunPublisher", () => {
  it("creates the check run on the target's head SHA", async () => {
    const client = makeClient();
    const rendered: RenderedCheckRun = {
      conclusion: "success",
      output: { title: "No issues found", summary: "All clear." },
    };

    await createCheckRunPublisher(client)(target, rendered);

    expect(client.createCheckRun).toHaveBeenCalledExactlyOnceWith({
      owner: target.owner,
      repo: target.repo,
      headSha: target.headSha,
      conclusion: "success",
      output: rendered.output,
    });
  });
});
